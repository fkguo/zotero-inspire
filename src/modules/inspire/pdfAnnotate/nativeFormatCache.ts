import {
  isAuditedZotero10Build,
  type NativeOverlayProfile,
} from "./nativeOverlayProfile";
import type {
  NativeCitationFormat,
  NativeFormatFingerprint,
  NativeFormatHint,
} from "./nativeOverlayTypes";

const MAX_READ_BYTES = 65_536;
const MAX_DECODED_UNITS = 65_536;
const MAX_RETURNED_UNITS = 262_144;
const MAX_UNAUDITED_FILE_BYTES = 262_144;
const MIN_PREFIX_UNITS = 500;
const MAX_CACHE_ENTRIES = 300;
const MAX_TOTAL_JOBS = 8;

interface FormatJob {
  attachmentItemID: number;
  generation: number;
  coordinatorGeneration: number;
  path?: string;
  cachedHint?: NativeFormatHint;
}

export interface NativeFormatCompletion {
  attachmentItemID: number;
  generation: number;
  coordinatorGeneration: number;
  attempted: boolean;
  fingerprint?: NativeFormatFingerprint;
  hint?: NativeFormatHint;
  fingerprintChanged?: boolean;
  invalidateVerified?: boolean;
}

type CompletionHandler = (completion: NativeFormatCompletion) => void;
interface WeakRefLike<T extends object> {
  deref(): T | undefined;
}

export class NativeFormatCache {
  private nextGeneration = 1;
  private lineage = new Map<number, number>();
  private hints = new Map<number, NativeFormatHint>();
  private queue = new Map<number, FormatJob>();
  private active?: FormatJob;
  private activeReplacement?: FormatJob;
  private shutdownGeneration = 1;

  constructor(
    private readonly profile: NativeOverlayProfile,
    private readonly onComplete: CompletionHandler,
    private readonly isProtected: (attachmentItemID: number) => boolean,
    private readonly onIdentifierExhausted: () => void = () => undefined,
  ) {}

  getCurrentGeneration(attachmentItemID: number): number {
    const existing = this.lineage.get(attachmentItemID);
    if (existing) return existing;
    const generation = this.allocateGeneration();
    if (!generation) return 0;
    this.lineage.set(attachmentItemID, generation);
    this.capCache();
    return generation;
  }

  hasLineage(attachmentItemID: number): boolean {
    return this.lineage.has(attachmentItemID);
  }

  getVerifiedHint(
    attachmentItemID: number,
    verifiedGeneration: number | undefined,
  ): NativeCitationFormat | undefined {
    const hint = this.hints.get(attachmentItemID);
    if (!hint || hint.generation !== verifiedGeneration) return undefined;
    this.touchHint(attachmentItemID, hint);
    return hint.format;
  }

  enqueue(attachmentItemID: number, coordinatorGeneration: number): number {
    const generation = this.getCurrentGeneration(attachmentItemID);
    if (!generation) return 0;
    const path = getCachePath(attachmentItemID);
    const job = {
      attachmentItemID,
      generation,
      coordinatorGeneration,
      path,
      cachedHint: this.hints.get(attachmentItemID),
    };
    if (this.active?.attachmentItemID === attachmentItemID) {
      if (this.active.generation !== generation) this.activeReplacement = job;
      return generation;
    }
    if (this.queue.has(attachmentItemID)) {
      this.queue.set(attachmentItemID, job);
    } else if (this.queue.size + (this.active ? 1 : 0) < MAX_TOTAL_JOBS) {
      this.queue.set(attachmentItemID, job);
    }
    this.startNext();
    return generation;
  }

  invalidate(
    attachmentItemID: number,
    coordinatorGeneration: number,
    enqueueForeground: boolean,
  ): number {
    const generation = this.allocateGeneration();
    if (!generation) return 0;
    this.lineage.set(attachmentItemID, generation);
    this.hints.delete(attachmentItemID);
    this.queue.delete(attachmentItemID);
    if (this.active?.attachmentItemID === attachmentItemID) {
      this.activeReplacement = enqueueForeground
        ? {
            attachmentItemID,
            generation,
            coordinatorGeneration,
            path: getCachePath(attachmentItemID),
          }
        : undefined;
    } else if (enqueueForeground) {
      this.enqueue(attachmentItemID, coordinatorGeneration);
    }
    return generation;
  }

  shutdown(): void {
    this.shutdownGeneration++;
    this.queue.clear();
    this.active = undefined;
    this.activeReplacement = undefined;
    this.lineage.clear();
    this.hints.clear();
  }

  releaseUnprotectedInterest(attachmentItemID: number): void {
    if (this.isProtected(attachmentItemID)) return;
    this.queue.delete(attachmentItemID);
    if (this.activeReplacement?.attachmentItemID === attachmentItemID) {
      this.activeReplacement = undefined;
    }
  }

  private startNext(): void {
    if (this.active || this.queue.size === 0) return;
    const first = this.queue.entries().next().value as
      | [number, FormatJob]
      | undefined;
    if (!first) return;
    this.queue.delete(first[0]);
    this.active = first[1];
    const shutdownGeneration = this.shutdownGeneration;
    const selfRef = makeWeakRef(this);
    if (!selfRef) {
      this.active = undefined;
      return;
    }
    void runFormatJob(first[1], this.profile).then((completion) =>
      selfRef.deref()?.finishJob(completion, shutdownGeneration),
    );
  }

  private finishJob(
    completion: NativeFormatCompletion,
    shutdownGeneration: number,
  ): void {
    if (shutdownGeneration !== this.shutdownGeneration) return;
    const active = this.active;
    this.active = undefined;
    if (
      active &&
      completion.generation === this.lineage.get(completion.attachmentItemID)
    ) {
      if (completion.fingerprintChanged) {
        this.advanceAfterFingerprintChange(active, completion);
      } else {
        if (completion.hint) {
          this.hints.set(completion.attachmentItemID, completion.hint);
          this.capCache();
        }
        this.onComplete(completion);
      }
    }
    if (this.activeReplacement) {
      const replacement = this.activeReplacement;
      this.activeReplacement = undefined;
      this.queue.set(replacement.attachmentItemID, replacement);
    }
    this.startNext();
  }

  private allocateGeneration(): number {
    if (this.nextGeneration > Number.MAX_SAFE_INTEGER) {
      this.shutdown();
      this.onIdentifierExhausted();
      return 0;
    }
    return this.nextGeneration++;
  }

  private touchHint(attachmentItemID: number, hint: NativeFormatHint): void {
    this.hints.delete(attachmentItemID);
    this.hints.set(attachmentItemID, hint);
  }

  private capCache(): void {
    let protectedScans = 0;
    while (
      this.lineage.size > MAX_CACHE_ENTRIES &&
      protectedScans < this.lineage.size
    ) {
      const oldest = this.lineage.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      if (
        this.active?.attachmentItemID === oldest ||
        this.activeReplacement?.attachmentItemID === oldest ||
        this.queue.has(oldest) ||
        this.isProtected(oldest)
      ) {
        const generation = this.lineage.get(oldest)!;
        this.lineage.delete(oldest);
        this.lineage.set(oldest, generation);
        protectedScans++;
        continue;
      }
      this.lineage.delete(oldest);
      this.hints.delete(oldest);
      protectedScans = 0;
    }
  }

  private advanceAfterFingerprintChange(
    oldJob: FormatJob,
    completion: NativeFormatCompletion,
  ): void {
    const generation = this.allocateGeneration();
    if (!generation) return;
    this.lineage.set(oldJob.attachmentItemID, generation);
    this.hints.delete(oldJob.attachmentItemID);
    this.onComplete({
      ...completion,
      generation,
      attempted: false,
      fingerprintChanged: undefined,
      invalidateVerified: true,
    });
    if (!this.isProtected(oldJob.attachmentItemID)) return;
    this.queue.set(oldJob.attachmentItemID, {
      attachmentItemID: oldJob.attachmentItemID,
      generation,
      coordinatorGeneration: oldJob.coordinatorGeneration,
      path: oldJob.path,
    });
  }
}

function makeWeakRef<T extends object>(value: T): WeakRefLike<T> | undefined {
  try {
    const Constructor = (globalThis as any).WeakRef;
    return typeof Constructor === "function"
      ? new Constructor(value)
      : undefined;
  } catch {
    return undefined;
  }
}

async function runFormatJob(
  job: FormatJob,
  profile: NativeOverlayProfile,
): Promise<NativeFormatCompletion> {
  const base: NativeFormatCompletion = {
    attachmentItemID: job.attachmentItemID,
    generation: job.generation,
    coordinatorGeneration: job.coordinatorGeneration,
    attempted: true,
  };
  if (!job.path) return base;
  try {
    const before = await IOUtils.stat(job.path);
    const fingerprint = toFingerprint(before);
    if (!fingerprint) return base;
    if (job.cachedHint) {
      if (sameFingerprint(job.cachedHint.fingerprint, fingerprint)) {
        return {
          ...base,
          fingerprint,
          hint: { ...job.cachedHint, generation: job.generation },
        };
      }
      return { ...base, fingerprintChanged: true };
    }
    if (
      !isAuditedZotero10Build(profile) &&
      fingerprint.size > MAX_UNAUDITED_FILE_BYTES
    ) {
      return base;
    }
    const content = await Zotero.File.getContentsAsync(
      job.path,
      undefined,
      MAX_READ_BYTES,
    );
    if (typeof content !== "string" || content.length > MAX_RETURNED_UNITS) {
      return base;
    }
    const after = await IOUtils.stat(job.path);
    const afterFingerprint = toFingerprint(after);
    if (!afterFingerprint || !sameFingerprint(fingerprint, afterFingerprint)) {
      return base;
    }
    const prefix = content.slice(0, MAX_DECODED_UNITS);
    if (prefix.length <= MIN_PREFIX_UNITS) {
      return { ...base, fingerprint };
    }
    const format = classifyCitationText(prefix);
    return {
      ...base,
      fingerprint,
      hint: {
        attachmentItemID: job.attachmentItemID,
        generation: job.generation,
        fingerprint,
        format,
      },
    };
  } catch {
    return base;
  }
}

function getCachePath(attachmentItemID: number): string | undefined {
  try {
    const item = Zotero.Items.get(attachmentItemID);
    if (!item || typeof Zotero.Fulltext?.getItemCacheFile !== "function") {
      return undefined;
    }
    const file = Zotero.Fulltext.getItemCacheFile(item);
    return typeof file?.path === "string" ? file.path : undefined;
  } catch {
    return undefined;
  }
}

function toFingerprint(value: any): NativeFormatFingerprint | undefined {
  const size = value?.size;
  const lastModified = value?.lastModified;
  return Number.isFinite(size) &&
    size >= 0 &&
    Number.isFinite(lastModified) &&
    lastModified >= 0
    ? { size, lastModified }
    : undefined;
}

function sameFingerprint(
  a: NativeFormatFingerprint,
  b: NativeFormatFingerprint,
): boolean {
  return a.size === b.size && a.lastModified === b.lastModified;
}

export function classifyCitationText(text: string): NativeCitationFormat {
  if (text.length > 8_192) {
    const first = countCitationForms(text.slice(0, 4_096));
    const last = countCitationForms(text.slice(-4_096));
    return decideFormat(
      first.numeric + last.numeric,
      first.authorYear + last.authorYear,
    );
  }
  const counts = countCitationForms(text);
  return decideFormat(counts.numeric, counts.authorYear);
}

function countCitationForms(text: string): {
  numeric: number;
  authorYear: number;
} {
  const numeric =
    (text.match(/\[\d+(?:\s*[-–,]\s*\d+)*\]/g)?.length || 0) +
    (text.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g)?.length || 0);
  const authorYear =
    (text.match(
      /\([A-Z][a-zA-Z'''-]+(?:(?:\s*,\s*|\s+and\s+)[A-Z][a-zA-Z'''-]+)*(?:\s+et\s+al\.?)?\s*,\s*\d{4}[a-z]?\)/gi,
    )?.length || 0) +
    (text.match(/[A-Z][a-zA-Z'''-]+\s+et\s+al\.?\s*\(\d{4}[a-z]?\)/gi)
      ?.length || 0) +
    (text.match(
      /[A-Z][a-zA-Z'''-]+\s+and\s+[A-Z][a-zA-Z'''-]+\s*\(\d{4}[a-z]?\)/gi,
    )?.length || 0);
  return { numeric, authorYear };
}

function decideFormat(
  numericCount: number,
  authorYearCount: number,
): NativeCitationFormat {
  const totalCitations = numericCount + authorYearCount;
  if (totalCitations === 0) return "numeric";
  const authorYearRatio = authorYearCount / totalCitations;
  if (authorYearRatio >= 0.5) return "author-year";
  return "numeric";
}
