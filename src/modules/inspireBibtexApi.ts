import { config } from "../../package.json";
import { INSPIRE_API_BASE } from "./inspire/constants";
import { createAbortController } from "./inspire/utils";
import { inspireFetch } from "./inspire/rateLimiter";

export const INSPIRE_BIBTEX_API_LIMITS = Object.freeze({
  maxCitationKeys: 20,
  maxCitationKeyLength: 200,
  betterBibtexReadyTimeoutMs: 2_000,
  betterBibtexExportTimeoutMs: 5_000,
  betterBibtexExportConcurrency: 1,
  networkTimeoutMs: 10_000,
  networkConcurrency: 4,
  maxRecidFieldLength: 64,
  maxBibtexEntryBytes: 128 * 1024,
  maxMergedBibtexBytes: 384 * 1024,
  maxResponseBytes: 1024 * 1024,
});

export type CitationKeySource =
  | "better-bibtex-key-manager"
  | "zotero-native"
  | "zotero-extra";

export type ResolverSource = "better-bibtex-key-manager" | "zotero-fields";
export type ResolverCoverage = "complete" | "degraded";
export type InspireLookupType = "inspire-record-id";
export type BetterBibtexFallbackReason =
  | "INSPIRE_RECID_MISSING"
  | "INSPIRE_RECORD_NOT_FOUND";

export interface ResolverInfo {
  source: ResolverSource;
  coverage: ResolverCoverage;
}

export interface ZoteroItemIdentity {
  library_id: number;
  library_type: "user" | "group";
  library_name: string;
  zotero_item_key: string;
  citation_key_sources: CitationKeySource[];
}

interface MatchedZoteroItem {
  item: Zotero.Item;
  identity: ZoteroItemIdentity;
}

export interface CitationKeyMatches {
  resolver: ResolverInfo;
  matches: Map<string, MatchedZoteroItem[]>;
}

export interface InspireLookupDescription {
  type: InspireLookupType;
  value: string;
  local_field: "archiveLocation";
}

export interface BetterBibtexLookupDescription {
  type: "better-bibtex-export";
  value: string;
  local_field: "zotero-item";
}

export type BibtexSource =
  | {
      provider: "INSPIRE-HEP";
      record_id: string;
      url: string;
      lookup: InspireLookupDescription;
    }
  | {
      provider: "Better BibTeX";
      fallback_reason: BetterBibtexFallbackReason;
      lookup: BetterBibtexLookupDescription;
    };

export interface BibtexRewriteResult {
  text: string;
  entryType: string;
  originalEntryKey: string;
  entryKey: string;
  rewritten: boolean;
}

export interface InspireBibtexSuccessResult {
  citation_key: string;
  status: "ok";
  item: ZoteroItemIdentity;
  source: BibtexSource;
  bibtex: {
    text: string;
    original_entry_key: string;
    entry_key: string;
    entry_key_rewritten: boolean;
  };
  field_provenance: {
    citation_key: "request";
    item: "zotero-item";
    "source.lookup": "zotero-item";
    "source.record_id"?: "zotero-item";
    "source.fallback_reason"?: "zotero-inspire";
    "bibtex.original_entry_key": "INSPIRE-HEP" | "Better BibTeX";
    "bibtex.entry_key": "request";
    "bibtex.text_except_entry_key": "INSPIRE-HEP" | "Better BibTeX";
  };
  fields_from_inspire: string[];
  fields_from_better_bibtex: string[];
}

export interface InspireBibtexErrorResult {
  citation_key: string;
  status: "error";
  code: string;
  error: string;
  candidates?: ZoteroItemIdentity[];
  item?: ZoteroItemIdentity;
  source?: BibtexSource;
  attempted_lookups?: InspireLookupDescription[];
}

export type InspireBibtexItemResult =
  | InspireBibtexSuccessResult
  | InspireBibtexErrorResult;

export interface InspireBibtexBatchResponse {
  ok: boolean;
  outcome: "ok" | "partial" | "error";
  api_version: "1";
  resolver: ResolverInfo;
  summary: {
    requested: number;
    succeeded: number;
    failed: number;
  };
  results: InspireBibtexItemResult[];
  bibtex: string;
}

export class InspireBibtexApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "InspireBibtexApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const INVALID_CITATION_KEY_RE = /[\s\\"#%'(),={}~]/u;
const EXTRA_CITATION_KEY_RE = /^(?:citation[ -]?key|bibtex):(.*)$/i;
const NON_ENTRY_BIBTEX_TYPES = new Set(["comment", "preamble", "string"]);
const BETTER_BIBTEX_TRANSLATOR_ID = "ca65189f-8815-4afe-8c8b-8c7c15f0edca";

interface BibtexEntryHeader {
  entryType: string;
  originalEntryKey: string;
  keyStart: number;
  keyEnd: number;
}

interface ZoteroFieldCandidateQuery {
  candidates: Map<string, Map<number, Set<CitationKeySource>>>;
  nativeCitationKeyCoverage: boolean;
}

interface BetterBibtexExportSlotWaiter {
  acquired: boolean;
  blockedError: InspireBibtexApiError;
  resolve: () => void;
  reject: (reason: InspireBibtexApiError) => void;
}

interface NetworkSlotWaiter {
  signal: AbortSignal;
  abortError: InspireBibtexApiError;
  blockedError: InspireBibtexApiError;
  resolve: (lease: NetworkPipelineLease) => void;
  reject: (reason: InspireBibtexApiError) => void;
  onAbort: () => void;
}

interface NetworkPipelineLease {
  finished: boolean;
  orphaned: boolean;
  released: boolean;
}

interface BetterBibtexReadinessGate {
  identity: object;
  state: "pending" | "resolved" | "rejected";
  settlement: Promise<boolean>;
  initialWait?: Promise<boolean>;
  timedOut: boolean;
}

let activeNetworkPipelines = 0;
const networkSlotWaiters: NetworkSlotWaiter[] = [];
let orphanedNetworkPipelines = 0;
let networkCircuitOpen = false;
let activeBetterBibtexExports = 0;
const betterBibtexExportSlotWaiters: BetterBibtexExportSlotWaiter[] = [];
let betterBibtexExportCircuitOpen = false;
let betterBibtexReadinessGate: BetterBibtexReadinessGate | undefined;

function acquireNetworkSlot(
  signal: AbortSignal,
  abortError: InspireBibtexApiError,
  blockedError: InspireBibtexApiError,
): Promise<NetworkPipelineLease> {
  if (signal.aborted) return Promise.reject(abortError);
  if (networkCircuitOpen) return Promise.reject(blockedError);
  if (activeNetworkPipelines < INSPIRE_BIBTEX_API_LIMITS.networkConcurrency) {
    activeNetworkPipelines++;
    return Promise.resolve({
      finished: false,
      orphaned: false,
      released: false,
    });
  }

  return new Promise<NetworkPipelineLease>((resolve, reject) => {
    const waiter = {} as NetworkSlotWaiter;
    waiter.signal = signal;
    waiter.abortError = abortError;
    waiter.blockedError = blockedError;
    waiter.resolve = resolve;
    waiter.reject = reject;
    waiter.onAbort = () => {
      const index = networkSlotWaiters.indexOf(waiter);
      if (index >= 0) networkSlotWaiters.splice(index, 1);
      signal.removeEventListener("abort", waiter.onAbort);
      reject(abortError);
    };
    networkSlotWaiters.push(waiter);
    signal.addEventListener("abort", waiter.onAbort, { once: true });
  });
}

function releaseNetworkSlot(): void {
  while (networkSlotWaiters.length) {
    const waiter = networkSlotWaiters.shift()!;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.signal.aborted) {
      waiter.reject(waiter.abortError);
      continue;
    }
    // Transfer the active slot directly to the oldest waiter.
    waiter.resolve({ finished: false, orphaned: false, released: false });
    return;
  }
  activeNetworkPipelines = Math.max(0, activeNetworkPipelines - 1);
}

function releaseNetworkPipelineLease(lease: NetworkPipelineLease): void {
  if (lease.released) return;
  lease.released = true;
  releaseNetworkSlot();
}

function finishNetworkPipeline(lease: NetworkPipelineLease): void {
  lease.finished = true;
  if (!lease.orphaned) releaseNetworkPipelineLease(lease);
}

function retainNetworkPipelineLease(lease: NetworkPipelineLease): boolean {
  if (lease.orphaned || lease.released) return false;
  lease.orphaned = true;
  orphanedNetworkPipelines++;
  return true;
}

function openNetworkCircuit(): void {
  networkCircuitOpen = true;
  while (networkSlotWaiters.length) {
    const waiter = networkSlotWaiters.shift()!;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    waiter.reject(waiter.blockedError);
  }
}

function tripNetworkCircuit(lease: NetworkPipelineLease): void {
  if (!retainNetworkPipelineLease(lease)) return;
  openNetworkCircuit();
}

function settleOrphanedNetworkPipeline(lease: NetworkPipelineLease): void {
  if (!lease.orphaned) return;
  lease.orphaned = false;
  orphanedNetworkPipelines = Math.max(0, orphanedNetworkPipelines - 1);
  if (orphanedNetworkPipelines === 0) networkCircuitOpen = false;
  if (lease.finished) releaseNetworkPipelineLease(lease);
}

function retainNetworkPipelineUntilCleanup(
  lease: NetworkPipelineLease,
  cleanup: Promise<void>,
): void {
  tripNetworkCircuit(lease);
  void cleanup.then(
    () => {
      settleOrphanedNetworkPipeline(lease);
    },
    (err) => {
      debug(`INSPIRE response cleanup failed: ${err}`);
      settleOrphanedNetworkPipeline(lease);
    },
  );
}

function acquireBetterBibtexExportSlot(blockedError: InspireBibtexApiError): {
  promise: Promise<void>;
  cancel: (reason: InspireBibtexApiError) => void;
} {
  let waiter: BetterBibtexExportSlotWaiter | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    if (betterBibtexExportCircuitOpen) {
      reject(blockedError);
      return;
    }
    if (
      activeBetterBibtexExports <
      INSPIRE_BIBTEX_API_LIMITS.betterBibtexExportConcurrency
    ) {
      activeBetterBibtexExports++;
      resolve();
      return;
    }
    waiter = { acquired: false, blockedError, resolve, reject };
    betterBibtexExportSlotWaiters.push(waiter);
  });

  return {
    promise,
    cancel: (reason) => {
      if (!waiter || waiter.acquired) return;
      const index = betterBibtexExportSlotWaiters.indexOf(waiter);
      if (index < 0) return;
      betterBibtexExportSlotWaiters.splice(index, 1);
      waiter.reject(reason);
    },
  };
}

function tripBetterBibtexExportCircuit(): void {
  betterBibtexExportCircuitOpen = true;
  while (betterBibtexExportSlotWaiters.length) {
    const waiter = betterBibtexExportSlotWaiters.shift()!;
    waiter.reject(waiter.blockedError);
  }
}

function releaseBetterBibtexExportSlot(): void {
  if (betterBibtexExportCircuitOpen) {
    betterBibtexExportCircuitOpen = false;
    activeBetterBibtexExports = Math.max(0, activeBetterBibtexExports - 1);
    return;
  }
  const waiter = betterBibtexExportSlotWaiters.shift();
  if (waiter) {
    waiter.acquired = true;
    waiter.resolve();
    return;
  }
  activeBetterBibtexExports = Math.max(0, activeBetterBibtexExports - 1);
}

export function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }
  return unescape(encodeURIComponent(value)).length;
}

function hasInvalidCitationKeyCharacter(value: string): boolean {
  if (INVALID_CITATION_KEY_RE.test(value)) return true;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

export function validateCitationKeys(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new InspireBibtexApiError(
      400,
      "INVALID_CITATION_KEYS",
      "citation_keys must be a non-empty array",
    );
  }
  if (raw.length > INSPIRE_BIBTEX_API_LIMITS.maxCitationKeys) {
    throw new InspireBibtexApiError(
      400,
      "TOO_MANY_CITATION_KEYS",
      `citation_keys accepts at most ${INSPIRE_BIBTEX_API_LIMITS.maxCitationKeys} entries`,
    );
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index++) {
    const value = raw[index];
    if (
      typeof value !== "string" ||
      !value ||
      value.length > INSPIRE_BIBTEX_API_LIMITS.maxCitationKeyLength ||
      value !== value.trim() ||
      hasInvalidCitationKeyCharacter(value)
    ) {
      throw new InspireBibtexApiError(
        400,
        "INVALID_CITATION_KEYS",
        `citation_keys[${index}] is not a supported BibTeX citation key`,
      );
    }
    if (seen.has(value)) {
      throw new InspireBibtexApiError(
        400,
        "DUPLICATE_CITATION_KEY",
        `citation_keys contains a duplicate at index ${index}`,
      );
    }
    seen.add(value);
    keys.push(value);
  }
  return keys;
}

function findBibtexBlockEnd(
  bibtex: string,
  openIndex: number,
  opener: "{" | "(",
): number {
  let braceDepth = opener === "{" ? 1 : 0;
  let parenDepth = opener === "(" ? 1 : 0;
  let inQuote = false;

  for (let index = openIndex + 1; index < bibtex.length; index++) {
    const char = bibtex[index];
    if (char === "\\") {
      index++;
      continue;
    }
    const commentAllowed =
      opener === "{" ? braceDepth === 1 : braceDepth === 0 && parenDepth === 1;
    if (char === "%" && !inQuote && commentAllowed) {
      const newline = bibtex.indexOf("\n", index + 1);
      if (newline < 0) break;
      index = newline;
      continue;
    }

    if (opener === "{") {
      if (char === '"' && braceDepth === 1) {
        inQuote = !inQuote;
      } else if (!inQuote && char === "{") {
        braceDepth++;
      } else if (!inQuote && char === "}") {
        braceDepth--;
        if (braceDepth === 0) return index;
      }
      continue;
    }

    if (char === '"' && braceDepth === 0) {
      inQuote = !inQuote;
    } else if (!inQuote && char === "{") {
      braceDepth++;
    } else if (!inQuote && char === "}" && braceDepth > 0) {
      braceDepth--;
    } else if (!inQuote && braceDepth === 0 && char === "(") {
      parenDepth++;
    } else if (!inQuote && braceDepth === 0 && char === ")") {
      parenDepth--;
      if (parenDepth === 0) return index;
    }
  }

  throw new InspireBibtexApiError(
    502,
    "INSPIRE_BIBTEX_INVALID",
    "INSPIRE BibTeX contains an unterminated entry",
  );
}

function scanBibtexEntryHeaders(bibtex: string): BibtexEntryHeader[] {
  const entries: BibtexEntryHeader[] = [];
  let cursor = 0;

  while (cursor < bibtex.length) {
    if (bibtex[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (bibtex[cursor] === "%") {
      const newline = bibtex.indexOf("\n", cursor + 1);
      if (newline < 0) break;
      cursor = newline + 1;
      continue;
    }
    if (bibtex[cursor] !== "@") {
      cursor++;
      continue;
    }

    const atIndex = cursor;
    cursor++;
    const typeStart = cursor;
    while (/[A-Za-z0-9_-]/.test(bibtex[cursor] || "")) cursor++;
    if (cursor === typeStart || !/[A-Za-z]/.test(bibtex[typeStart])) {
      cursor = atIndex + 1;
      continue;
    }
    const entryType = bibtex.slice(typeStart, cursor);
    while (/\s/.test(bibtex[cursor] || "")) cursor++;
    const opener = bibtex[cursor];
    if (opener !== "{" && opener !== "(") {
      cursor = atIndex + 1;
      continue;
    }

    const blockEnd = findBibtexBlockEnd(bibtex, cursor, opener);
    if (!NON_ENTRY_BIBTEX_TYPES.has(entryType.toLowerCase())) {
      let keyStart = cursor + 1;
      while (/\s/.test(bibtex[keyStart] || "")) keyStart++;
      const comma = bibtex.indexOf(",", keyStart);
      if (comma < 0 || comma >= blockEnd) {
        throw new InspireBibtexApiError(
          502,
          "INSPIRE_BIBTEX_INVALID",
          "INSPIRE BibTeX entry header has no citation-key delimiter",
        );
      }
      let keyEnd = comma;
      while (keyEnd > keyStart && /\s/.test(bibtex[keyEnd - 1])) keyEnd--;
      const originalEntryKey = bibtex.slice(keyStart, keyEnd);
      if (!originalEntryKey || /[\s,{}()\\]/u.test(originalEntryKey)) {
        throw new InspireBibtexApiError(
          502,
          "INSPIRE_BIBTEX_INVALID",
          "INSPIRE BibTeX entry key is missing or unsafe",
        );
      }
      entries.push({ entryType, originalEntryKey, keyStart, keyEnd });
    }
    cursor = blockEnd + 1;
  }

  return entries;
}

/**
 * Rewrite the key of exactly one data entry while leaving every INSPIRE field
 * byte-for-byte unchanged. Auxiliary @comment/@preamble/@string blocks are not
 * treated as data entries.
 */
export function rewriteSingleBibtexEntryKey(
  bibtex: string,
  citationKey: string,
): BibtexRewriteResult {
  if (typeof bibtex !== "string" || !bibtex.trim()) {
    throw new InspireBibtexApiError(
      502,
      "INSPIRE_BIBTEX_INVALID",
      "INSPIRE returned an empty BibTeX response",
    );
  }

  const matches = scanBibtexEntryHeaders(bibtex);

  if (matches.length !== 1) {
    throw new InspireBibtexApiError(
      502,
      "INSPIRE_BIBTEX_INVALID",
      `INSPIRE BibTeX must contain exactly one data entry (received ${matches.length})`,
    );
  }

  const header = matches[0];
  const text = `${bibtex.slice(0, header.keyStart)}${citationKey}${bibtex.slice(header.keyEnd)}`;
  return {
    text,
    entryType: header.entryType,
    originalEntryKey: header.originalEntryKey,
    entryKey: citationKey,
    rewritten: header.originalEntryKey !== citationKey,
  };
}

/** Mirror Better BibTeX's Extra-field labels and last-value-wins behavior. */
export function extractCitationKeyFromExtra(extra: unknown): string | null {
  if (typeof extra !== "string" || !extra) return null;
  let citationKey: string | null = null;
  for (const line of extra.split(/\r?\n/)) {
    const match = line.match(EXTRA_CITATION_KEY_RE);
    if (match) citationKey = match[1].trim() || null;
  }
  return citationKey;
}

function debug(message: string): void {
  try {
    Zotero.debug?.(`[${config.addonName}] ${message}`);
  } catch (_err) {
    // Diagnostics must never change the endpoint's fail-closed behavior.
  }
}

function inspireTimeoutError(): InspireBibtexApiError {
  return new InspireBibtexApiError(
    504,
    "INSPIRE_TIMEOUT",
    `INSPIRE request exceeded ${INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs} ms`,
  );
}

function awaitAbortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  lease: NetworkPipelineLease,
  onLateResolve?: (value: T) => void | Promise<unknown>,
  onAbortCleanup?: () => void | Promise<unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    let abortCleanup: Promise<unknown> | undefined;
    const onAbort = () => {
      aborted = true;
      signal.removeEventListener("abort", onAbort);
      tripNetworkCircuit(lease);
      try {
        abortCleanup = Promise.resolve(onAbortCleanup?.()).catch((err) => {
          debug(`Timed-out INSPIRE operation cleanup failed: ${err}`);
        });
      } catch (err) {
        debug(`Timed-out INSPIRE operation cleanup failed: ${err}`);
        abortCleanup = Promise.resolve();
      }
      reject(inspireTimeoutError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      async (value) => {
        signal.removeEventListener("abort", onAbort);
        if (aborted) {
          try {
            await onLateResolve?.(value);
          } catch (err) {
            debug(`Late INSPIRE response cleanup failed: ${err}`);
          }
          await abortCleanup;
          settleOrphanedNetworkPipeline(lease);
          return;
        }
        resolve(value);
      },
      async (err) => {
        signal.removeEventListener("abort", onAbort);
        if (aborted) {
          await abortCleanup;
          settleOrphanedNetworkPipeline(lease);
          return;
        }
        reject(err);
      },
    );
    if (signal.aborted) onAbort();
  });
}

async function waitForBetterBibtexReady(betterBibtex: any): Promise<boolean> {
  let ready: any;
  let then: any;
  try {
    ready = betterBibtex?.ready;
    then = ready?.then;
  } catch (err) {
    debug(`Better BibTeX readiness access failed: ${err}`);
    return false;
  }
  if (!ready || typeof then !== "function") return true;

  const identity = ready as object;
  let gate = betterBibtexReadinessGate;
  if (!gate || gate.identity !== identity) {
    gate = {
      identity,
      state: "pending",
      settlement: undefined as unknown as Promise<boolean>,
      timedOut: false,
    };
    gate.settlement = new Promise<boolean>((resolve) => {
      const settle = (state: "resolved" | "rejected", value: boolean) => {
        if (gate!.state !== "pending") return;
        gate!.state = state;
        resolve(value);
      };
      try {
        then.call(
          ready,
          () => settle("resolved", true),
          (err: unknown) => {
            debug(`Better BibTeX citation-key adapter unavailable: ${err}`);
            settle("rejected", false);
          },
        );
      } catch (err) {
        debug(`Better BibTeX citation-key adapter unavailable: ${err}`);
        settle("rejected", false);
      }
    });
    betterBibtexReadinessGate = gate;
  }

  if (gate.state === "resolved") return true;
  if (gate.state === "rejected" || gate.timedOut) return false;
  if (!gate.initialWait) {
    gate.initialWait = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        gate!.timedOut = true;
        debug("Better BibTeX citation-key adapter readiness timed out");
        resolve(false);
      }, INSPIRE_BIBTEX_API_LIMITS.betterBibtexReadyTimeoutMs);
      void gate!.settlement.then((available) => {
        clearTimeout(timer);
        resolve(available);
      });
    });
  }
  return await gate.initialWait;
}

async function getBetterBibtexRecords(
  citationKeys: string[],
  betterBibtex: any,
): Promise<any[] | null> {
  if (!betterBibtex) return null;
  if (!(await waitForBetterBibtexReady(betterBibtex))) return null;

  let manager: any;
  try {
    manager = betterBibtex.KeyManager;
    if (!manager || typeof manager.all !== "function") return null;
  } catch (err) {
    debug(`Better BibTeX KeyManager access failed: ${err}`);
    return null;
  }
  const wanted = new Set(citationKeys);
  try {
    const records = manager.all.call(
      manager,
      (record: any) =>
        typeof record?.citationKey === "string" &&
        wanted.has(record.citationKey),
    );
    if (!Array.isArray(records)) {
      debug("Better BibTeX KeyManager.all returned an unsupported value");
      return null;
    }
    if (
      records.some(
        (record: any) =>
          typeof record?.citationKey !== "string" ||
          !wanted.has(record.citationKey) ||
          typeof record.itemID !== "number" ||
          !Number.isInteger(record.itemID) ||
          record.itemID <= 0,
      )
    ) {
      debug("Better BibTeX KeyManager.all returned unsupported record data");
      return null;
    }
    return records;
  } catch (err) {
    debug(`Better BibTeX KeyManager.all failed: ${err}`);
    return null;
  }
}

function escapeSqlLike(value: string): string {
  return value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
}

async function queryZoteroFieldCandidates(
  citationKeys: string[],
): Promise<ZoteroFieldCandidateQuery> {
  const candidates = new Map<string, Map<number, Set<CitationKeySource>>>();
  const wanted = new Set(citationKeys);
  let nativeCitationKeyCoverage = false;

  const add = (key: string, itemID: number, source: CitationKeySource) => {
    if (!wanted.has(key) || !Number.isInteger(itemID) || itemID <= 0) return;
    let byItem = candidates.get(key);
    if (!byItem) candidates.set(key, (byItem = new Map()));
    let sources = byItem.get(itemID);
    if (!sources) byItem.set(itemID, (sources = new Set()));
    sources.add(source);
  };

  let nativeFieldID: number | false | undefined;
  try {
    nativeFieldID = Zotero.ItemFields.getID("citationKey");
  } catch (_err) {
    nativeFieldID = false;
  }
  if (nativeFieldID) {
    const placeholders = citationKeys.map(() => "?").join(",");
    const rows = await Zotero.DB.queryAsync(
      `
        SELECT itemID, value
        FROM itemData
          JOIN itemDataValues USING(valueID)
        WHERE fieldID = ? AND value IN (${placeholders})
      `,
      [nativeFieldID, ...citationKeys],
    );
    if (
      Array.isArray(rows) &&
      rows.every(
        (row: any) =>
          typeof row?.value === "string" &&
          Number.isInteger(Number(row.itemID)) &&
          Number(row.itemID) > 0,
      )
    ) {
      nativeCitationKeyCoverage = true;
      for (const row of rows) {
        add(row.value, Number(row.itemID), "zotero-native");
      }
    } else {
      debug("Zotero native citation-key query returned an unsupported value");
    }
  }

  const extraFieldID = Zotero.ItemFields.getID("extra");
  if (extraFieldID) {
    const labels = [
      "Citation Key:",
      "Citation-Key:",
      "CitationKey:",
      "BibTeX:",
    ];
    const patterns = citationKeys.flatMap((key) =>
      labels.map((label) => `%${label}%${escapeSqlLike(key)}%`),
    );
    const conditions = patterns
      .map(() => "value LIKE ? ESCAPE '!'")
      .join(" OR ");
    const rows = await Zotero.DB.queryAsync(
      `
        SELECT itemID, value
        FROM itemData
          JOIN itemDataValues USING(valueID)
        WHERE fieldID = ? AND (${conditions})
      `,
      [extraFieldID, ...patterns],
    );
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const key = extractCitationKeyFromExtra(row?.value);
        if (!key) continue;
        const itemID = Number(row.itemID);
        if (
          (Number((Zotero as any).platformMajorVersion) || 0) >= 8 &&
          nativeCitationKeyCoverage
        ) {
          // A successful Zotero 8+ native-field query is authoritative.
          // Extra may corroborate that same item, but a stale Extra-only key
          // must never create a positive match.
          if (candidates.get(key)?.has(itemID)) {
            add(key, itemID, "zotero-extra");
          }
        } else {
          add(key, itemID, "zotero-extra");
        }
      }
    }
  }

  return { candidates, nativeCitationKeyCoverage };
}

function sourceRank(source: CitationKeySource): number {
  switch (source) {
    case "better-bibtex-key-manager":
      return 0;
    case "zotero-native":
      return 1;
    case "zotero-extra":
      return 2;
  }
}

function itemIsFeedItem(item: Zotero.Item): boolean {
  try {
    const marker = (item as any).isFeedItem;
    if (typeof marker === "function") {
      return marker.call(item) === true;
    }
    return marker === true;
  } catch (_err) {
    // An item whose feed status cannot be established is not safe to expose.
    return true;
  }
}

async function materializeMatches(
  citationKeys: string[],
  candidates: Map<string, Map<number, Set<CitationKeySource>>>,
): Promise<Map<string, MatchedZoteroItem[]>> {
  const ids = new Set<number>();
  for (const byItem of candidates.values()) {
    for (const itemID of byItem.keys()) ids.add(itemID);
  }

  const matches = new Map<string, MatchedZoteroItem[]>();
  for (const key of citationKeys) matches.set(key, []);
  if (!ids.size) return matches;

  const loaded = await Zotero.Items.getAsync([...ids]);
  const items = (Array.isArray(loaded) ? loaded : [loaded]).filter(
    (item): item is Zotero.Item => !!item,
  );
  const itemByID = new Map<number, Zotero.Item>();
  for (const item of items) itemByID.set(Number(item.id), item);

  for (const key of citationKeys) {
    const byItem = candidates.get(key);
    if (!byItem) continue;
    const resolved: MatchedZoteroItem[] = [];
    for (const [itemID, sourceSet] of byItem) {
      const item = itemByID.get(itemID);
      if (
        !item ||
        item.deleted ||
        !item.isRegularItem() ||
        itemIsFeedItem(item)
      ) {
        continue;
      }
      const library = Zotero.Libraries.get(item.libraryID) as any;
      const libraryType =
        library?.libraryType ||
        (item.libraryID === Zotero.Libraries.userLibraryID
          ? "user"
          : undefined);
      if (libraryType !== "user" && libraryType !== "group") continue;

      resolved.push({
        item,
        identity: {
          library_id: item.libraryID,
          library_type: libraryType,
          library_name:
            typeof library?.name === "string" && library.name
              ? library.name
              : `Library ${item.libraryID}`,
          zotero_item_key: item.key,
          citation_key_sources: [...sourceSet].sort(
            (a, b) => sourceRank(a) - sourceRank(b),
          ),
        },
      });
    }
    resolved.sort(
      (a, b) =>
        a.identity.library_id - b.identity.library_id ||
        a.identity.zotero_item_key.localeCompare(b.identity.zotero_item_key),
    );
    matches.set(key, resolved);
  }
  return matches;
}

/**
 * Resolve CAYW keys across the user and group libraries. Better BibTeX's
 * ready KeyManager is authoritative; Zotero fields are a compatibility
 * adapter used only when that authority is unavailable.
 */
export async function findItemsByCitationKeys(
  citationKeys: string[],
): Promise<CitationKeyMatches> {
  let betterBibtex: any;
  let betterBibtexInstalled = false;
  try {
    betterBibtex = (Zotero as any).BetterBibTeX;
    betterBibtexInstalled = !!betterBibtex;
  } catch (err) {
    debug(`Better BibTeX adapter access failed: ${err}`);
    betterBibtexInstalled = true;
  }
  const betterBibtexRecords = await getBetterBibtexRecords(
    citationKeys,
    betterBibtex,
  );
  if (betterBibtexRecords !== null) {
    const candidates = new Map<string, Map<number, Set<CitationKeySource>>>();
    for (const key of citationKeys) candidates.set(key, new Map());
    for (const record of betterBibtexRecords) {
      if (
        typeof record?.citationKey !== "string" ||
        !candidates.has(record.citationKey)
      ) {
        continue;
      }
      const itemID = record.itemID as number;
      if (!Number.isInteger(itemID) || itemID <= 0) continue;
      candidates
        .get(record.citationKey)!
        .set(itemID, new Set(["better-bibtex-key-manager"]));
    }
    return {
      resolver: {
        source: "better-bibtex-key-manager",
        coverage: "complete",
      },
      matches: await materializeMatches(citationKeys, candidates),
    };
  }

  const fieldQuery = await queryZoteroFieldCandidates(citationKeys);
  const platformMajorVersion =
    Number((Zotero as any).platformMajorVersion) || 0;
  return {
    resolver: {
      source: "zotero-fields",
      coverage:
        !betterBibtexInstalled &&
        platformMajorVersion >= 8 &&
        fieldQuery.nativeCitationKeyCoverage
          ? "complete"
          : "degraded",
    },
    matches: await materializeMatches(citationKeys, fieldQuery.candidates),
  };
}

function readRecidField(item: Zotero.Item, field: string): string {
  let value: unknown;
  try {
    value = item.getField(field);
  } catch (err) {
    debug(`Reading Zotero recid field ${field} failed: ${err}`);
    throw new InspireBibtexApiError(
      500,
      "INSPIRE_RECID_READ_ERROR",
      "The Zotero INSPIRE recid fields could not be read safely",
    );
  }
  if (typeof value !== "string") {
    throw new InspireBibtexApiError(
      500,
      "INSPIRE_RECID_READ_ERROR",
      "The Zotero INSPIRE recid fields could not be read safely",
    );
  }
  if (value.length > INSPIRE_BIBTEX_API_LIMITS.maxRecidFieldLength) {
    throw new InspireBibtexApiError(
      422,
      "INSPIRE_RECID_FIELD_TOO_LARGE",
      `The Zotero item's ${field} field exceeds the recid-read limit`,
    );
  }
  return value;
}

function extractCanonicalInspireLookup(
  item: Zotero.Item,
): InspireLookupDescription | null {
  const archive = readRecidField(item, "archive");
  if (archive !== "INSPIRE") return null;
  const archiveLocation = readRecidField(item, "archiveLocation");
  if (!archiveLocation) return null;
  if (!/^\d+$/.test(archiveLocation)) {
    throw new InspireBibtexApiError(
      422,
      "INSPIRE_RECID_INVALID",
      "The Zotero item's INSPIRE recid is missing or invalid",
    );
  }
  const recid = archiveLocation.replace(/^0+(?=\d)/, "");
  if (recid === "0") {
    throw new InspireBibtexApiError(
      422,
      "INSPIRE_RECID_INVALID",
      "The Zotero item's INSPIRE recid is missing or invalid",
    );
  }
  return {
    type: "inspire-record-id",
    value: recid,
    local_field: "archiveLocation",
  };
}

function invalidInspireUtf8Error(): InspireBibtexApiError {
  return new InspireBibtexApiError(
    502,
    "INSPIRE_BIBTEX_INVALID",
    "INSPIRE returned BibTeX that is not valid UTF-8",
  );
}

async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
  tooLargeCode: string,
  controller: AbortController,
  lease: NetworkPipelineLease,
): Promise<string> {
  const contentLength = Number(response.headers?.get?.("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    controller.abort();
    retainNetworkPipelineUntilCleanup(
      lease,
      cancelResponseBody(response, "oversized Content-Length response"),
    );
    throw new InspireBibtexApiError(
      502,
      tooLargeCode,
      `INSPIRE response exceeds the ${maxBytes}-byte limit`,
    );
  }

  const body = response.body;
  if (
    body &&
    typeof body.getReader === "function" &&
    typeof TextDecoder !== "undefined"
  ) {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    });
    let total = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await awaitAbortable<
          ReadableStreamReadResult<Uint8Array>
        >(
          reader.read() as Promise<ReadableStreamReadResult<Uint8Array>>,
          controller.signal,
          lease,
          undefined,
          () => cancelResponseReader(reader, "timed-out response stream"),
        );
        if (done) break;
        total += value?.byteLength || 0;
        if (total > maxBytes) {
          controller.abort();
          retainNetworkPipelineUntilCleanup(
            lease,
            cancelResponseReader(reader, "oversized response stream"),
          );
          throw new InspireBibtexApiError(
            502,
            tooLargeCode,
            `INSPIRE response exceeds the ${maxBytes}-byte limit`,
          );
        }
        try {
          text += decoder.decode(value, { stream: true });
        } catch (_err) {
          controller.abort();
          retainNetworkPipelineUntilCleanup(
            lease,
            cancelResponseReader(reader, "invalid UTF-8 response stream"),
          );
          throw invalidInspireUtf8Error();
        }
      }
      try {
        text += decoder.decode();
      } catch (_err) {
        throw invalidInspireUtf8Error();
      }
      return text;
    } catch (err) {
      if (err instanceof InspireBibtexApiError) {
        throw err;
      }
      const aborted =
        controller.signal.aborted || (err as any)?.name === "AbortError";
      if (!controller.signal.aborted) controller.abort();
      retainNetworkPipelineUntilCleanup(
        lease,
        cancelResponseReader(reader, "failed response stream"),
      );
      if (aborted) throw inspireTimeoutError();
      debug(`INSPIRE response stream failed: ${err}`);
      throw new InspireBibtexApiError(
        502,
        "INSPIRE_NETWORK_ERROR",
        "INSPIRE response stream failed before the body was complete",
      );
    } finally {
      try {
        reader.releaseLock?.();
      } catch (err) {
        debug(`INSPIRE response reader release failed: ${err}`);
      }
    }
  }

  controller.abort();
  retainNetworkPipelineUntilCleanup(
    lease,
    cancelResponseBody(response, "unbounded response body"),
  );
  throw new InspireBibtexApiError(
    502,
    "INSPIRE_RESPONSE_LIMIT_UNAVAILABLE",
    "The current runtime cannot enforce a bounded INSPIRE response read",
  );
}

async function requestInspire(
  url: string,
  accept: string,
  lease: NetworkPipelineLease,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const request = inspireFetch(url, {
      headers: { Accept: accept },
      signal,
      retryOnRateLimit: false,
    });
    if (!signal) return await request;
    return await awaitAbortable(request, signal, lease, (response) =>
      cancelResponseBody(response, "late response body"),
    );
  } catch (err) {
    if (err instanceof InspireBibtexApiError) throw err;
    if (signal?.aborted || (err as any)?.name === "AbortError") {
      throw new InspireBibtexApiError(
        504,
        "INSPIRE_TIMEOUT",
        `INSPIRE request exceeded ${INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs} ms`,
      );
    }
    debug(`INSPIRE network request failed: ${err}`);
    throw new InspireBibtexApiError(
      502,
      "INSPIRE_NETWORK_ERROR",
      "INSPIRE request failed before a response was received",
    );
  }
}

function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string,
): Promise<void> {
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === "function") {
      return cancellation.catch((err: unknown) => {
        debug(`INSPIRE ${reason} cancellation failed: ${err}`);
      });
    }
  } catch (err) {
    debug(`INSPIRE ${reason} cancellation failed: ${err}`);
  }
  return Promise.resolve();
}

function cancelResponseBody(response: Response, reason: string): Promise<void> {
  try {
    const cancellation = response.body?.cancel?.();
    if (cancellation && typeof cancellation.catch === "function") {
      return cancellation.catch((err: unknown) => {
        debug(`INSPIRE ${reason} cancellation failed: ${err}`);
      });
    }
  } catch (err) {
    debug(`INSPIRE ${reason} cancellation failed: ${err}`);
  }
  return Promise.resolve();
}

function throwForInspireStatus(
  response: Response,
  url: string,
  lease: NetworkPipelineLease,
): void {
  if (response.status === 429) {
    retainNetworkPipelineUntilCleanup(
      lease,
      cancelResponseBody(response, "rate-limited response body"),
    );
    throw new InspireBibtexApiError(
      503,
      "INSPIRE_RATE_LIMITED",
      "INSPIRE rate limit was reached",
      { retry_after: response.headers?.get?.("Retry-After") || undefined },
    );
  }
  if (!response.ok) {
    retainNetworkPipelineUntilCleanup(
      lease,
      cancelResponseBody(response, "HTTP error response body"),
    );
    throw new InspireBibtexApiError(
      502,
      "INSPIRE_HTTP_ERROR",
      `INSPIRE returned HTTP ${response.status}`,
      { upstream_status: response.status, upstream_url: url },
    );
  }
}

async function fetchBibtexByRecordID(
  recordID: string,
  controller: AbortController,
  lease: NetworkPipelineLease,
): Promise<{ text: string; url: string } | null> {
  const url = `${INSPIRE_API_BASE}/literature/${encodeURIComponent(recordID)}?format=bibtex`;
  const response = await requestInspire(
    url,
    "application/x-bibtex",
    lease,
    controller.signal,
  );
  if (response.status === 404) {
    retainNetworkPipelineUntilCleanup(
      lease,
      cancelResponseBody(response, "BibTeX miss response body"),
    );
    return null;
  }
  throwForInspireStatus(response, url, lease);
  const text = await readResponseTextBounded(
    response,
    INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes,
    "INSPIRE_BIBTEX_TOO_LARGE",
    controller,
    lease,
  );
  if (!text.trim()) {
    throw new InspireBibtexApiError(
      502,
      "INSPIRE_BIBTEX_INVALID",
      "INSPIRE returned an empty BibTeX response",
    );
  }
  return { text, url };
}

function betterBibtexFallbackSource(
  matched: MatchedZoteroItem,
  fallbackReason: BetterBibtexFallbackReason,
): Extract<BibtexSource, { provider: "Better BibTeX" }> {
  return {
    provider: "Better BibTeX",
    fallback_reason: fallbackReason,
    lookup: {
      type: "better-bibtex-export",
      value: matched.identity.zotero_item_key,
      local_field: "zotero-item",
    },
  };
}

function betterBibtexFallbackError(
  status: number,
  code: string,
  message: string,
  matched: MatchedZoteroItem,
  fallbackReason: BetterBibtexFallbackReason,
  attemptedLookups: InspireLookupDescription[],
): InspireBibtexApiError {
  return new InspireBibtexApiError(status, code, message, {
    item: matched.identity,
    source: betterBibtexFallbackSource(matched, fallbackReason),
    ...(attemptedLookups.length ? { attempted_lookups: attemptedLookups } : {}),
  });
}

async function performBetterBibtexExport(
  citationKey: string,
  matched: MatchedZoteroItem,
  fallbackReason: BetterBibtexFallbackReason,
  attemptedLookups: InspireLookupDescription[],
): Promise<InspireBibtexSuccessResult> {
  const unavailable = () =>
    betterBibtexFallbackError(
      503,
      "BETTER_BIBTEX_FALLBACK_UNAVAILABLE",
      "Better BibTeX export is unavailable",
      matched,
      fallbackReason,
      attemptedLookups,
    );
  const invalid = () =>
    betterBibtexFallbackError(
      502,
      "BETTER_BIBTEX_FALLBACK_INVALID",
      "Better BibTeX did not return exactly one valid BibTeX data entry",
      matched,
      fallbackReason,
      attemptedLookups,
    );

  let betterBibtex: any;
  try {
    betterBibtex = (Zotero as any).BetterBibTeX;
  } catch (err) {
    debug(`Better BibTeX fallback adapter access failed: ${err}`);
    throw unavailable();
  }
  if (!betterBibtex) throw unavailable();
  let ready: any;
  try {
    ready = betterBibtex.ready;
  } catch (err) {
    debug(`Better BibTeX fallback readiness access failed: ${err}`);
    throw unavailable();
  }
  if (ready && typeof ready.then === "function") {
    try {
      await ready;
    } catch (err) {
      debug(`Better BibTeX fallback readiness failed: ${err}`);
      throw unavailable();
    }
  }

  let ExportTranslator: any;
  try {
    ExportTranslator = (Zotero as any).Translate?.Export;
  } catch (err) {
    debug(`Zotero export translator access failed: ${err}`);
    throw unavailable();
  }
  if (typeof ExportTranslator !== "function") throw unavailable();

  let translation: any;
  try {
    translation = new ExportTranslator();
  } catch (err) {
    debug(`Better BibTeX fallback translator construction failed: ${err}`);
    throw unavailable();
  }
  let adapterUsable = false;
  try {
    adapterUsable =
      !!translation &&
      typeof translation.setItems === "function" &&
      typeof translation.setTranslator === "function" &&
      typeof translation.setDisplayOptions === "function" &&
      typeof translation.translate === "function";
  } catch (err) {
    debug(`Better BibTeX fallback translator inspection failed: ${err}`);
  }
  if (!adapterUsable) {
    throw unavailable();
  }

  let dynamicTranslatorID: unknown;
  try {
    dynamicTranslatorID =
      betterBibtex?.Translators?.bySlug?.BetterBibTeX?.translatorID;
  } catch (err) {
    debug(`Better BibTeX translator ID lookup failed: ${err}`);
  }
  const translatorID =
    typeof dynamicTranslatorID === "string" && dynamicTranslatorID
      ? dynamicTranslatorID
      : BETTER_BIBTEX_TRANSLATOR_ID;
  try {
    translation.setItems([matched.item]);
    translation.setTranslator(translatorID);
    translation.setDisplayOptions({
      worker: true,
      exportNotes: false,
      exportFileData: false,
      useJournalAbbreviation: false,
      keepUpdated: false,
    });
    await translation.translate();
  } catch (err) {
    debug(`Better BibTeX fallback export failed: ${err}`);
    throw betterBibtexFallbackError(
      502,
      "BETTER_BIBTEX_FALLBACK_ERROR",
      "Better BibTeX export failed",
      matched,
      fallbackReason,
      attemptedLookups,
    );
  }

  let raw: unknown;
  try {
    raw = translation.string;
  } catch (err) {
    debug(`Better BibTeX fallback output access failed: ${err}`);
    throw betterBibtexFallbackError(
      502,
      "BETTER_BIBTEX_FALLBACK_ERROR",
      "Better BibTeX export failed",
      matched,
      fallbackReason,
      attemptedLookups,
    );
  }
  if (typeof raw !== "string" || !raw.trim()) throw invalid();
  if (utf8ByteLength(raw) > INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes) {
    throw betterBibtexFallbackError(
      502,
      "BETTER_BIBTEX_FALLBACK_TOO_LARGE",
      `Better BibTeX output exceeds ${INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes} bytes`,
      matched,
      fallbackReason,
      attemptedLookups,
    );
  }

  let rewritten: BibtexRewriteResult;
  try {
    rewritten = rewriteSingleBibtexEntryKey(raw, citationKey);
  } catch (err) {
    debug(`Better BibTeX fallback output validation failed: ${err}`);
    throw invalid();
  }
  if (
    utf8ByteLength(rewritten.text) >
    INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes
  ) {
    throw betterBibtexFallbackError(
      502,
      "BETTER_BIBTEX_FALLBACK_TOO_LARGE",
      `Rewritten Better BibTeX output exceeds ${INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes} bytes`,
      matched,
      fallbackReason,
      attemptedLookups,
    );
  }

  return {
    citation_key: citationKey,
    status: "ok",
    item: matched.identity,
    source: betterBibtexFallbackSource(matched, fallbackReason),
    bibtex: {
      text: rewritten.text,
      original_entry_key: rewritten.originalEntryKey,
      entry_key: rewritten.entryKey,
      entry_key_rewritten: rewritten.rewritten,
    },
    field_provenance: {
      citation_key: "request",
      item: "zotero-item",
      "source.lookup": "zotero-item",
      "source.fallback_reason": "zotero-inspire",
      "bibtex.original_entry_key": "Better BibTeX",
      "bibtex.entry_key": "request",
      "bibtex.text_except_entry_key": "Better BibTeX",
    },
    fields_from_inspire: [],
    fields_from_better_bibtex: [
      "bibtex.original_entry_key",
      "bibtex.text_except_entry_key",
    ],
  };
}

async function exportBetterBibtexFallback(
  citationKey: string,
  matched: MatchedZoteroItem,
  fallbackReason: BetterBibtexFallbackReason,
  attemptedLookups: InspireLookupDescription[],
): Promise<InspireBibtexSuccessResult> {
  const timeoutError = betterBibtexFallbackError(
    504,
    "BETTER_BIBTEX_FALLBACK_TIMEOUT",
    `Better BibTeX export exceeded ${INSPIRE_BIBTEX_API_LIMITS.betterBibtexExportTimeoutMs} ms`,
    matched,
    fallbackReason,
    attemptedLookups,
  );
  const circuitOpenError = betterBibtexFallbackError(
    503,
    "BETTER_BIBTEX_FALLBACK_UNAVAILABLE",
    "Better BibTeX export is unavailable while a prior timed-out export is still running",
    matched,
    fallbackReason,
    attemptedLookups,
  );
  const slot = acquireBetterBibtexExportSlot(circuitOpenError);
  let exportActive = false;
  const operation = (async () => {
    await slot.promise;
    exportActive = true;
    try {
      return await performBetterBibtexExport(
        citationKey,
        matched,
        fallbackReason,
        attemptedLookups,
      );
    } finally {
      exportActive = false;
      releaseBetterBibtexExportSlot();
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      if (exportActive) {
        tripBetterBibtexExportCircuit();
      } else {
        slot.cancel(timeoutError);
      }
      reject(timeoutError);
    }, INSPIRE_BIBTEX_API_LIMITS.betterBibtexExportTimeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchAndRewriteForItem(
  citationKey: string,
  matched: MatchedZoteroItem,
): Promise<InspireBibtexSuccessResult> {
  const candidate = extractCanonicalInspireLookup(matched.item);
  if (!candidate) {
    return exportBetterBibtexFallback(
      citationKey,
      matched,
      "INSPIRE_RECID_MISSING",
      [],
    );
  }
  const attemptedLookups = [candidate];

  const controller = createAbortController();
  if (!controller) {
    throw new InspireBibtexApiError(
      503,
      "INSPIRE_ABORT_UNAVAILABLE",
      "The current runtime cannot cancel bounded INSPIRE requests",
      { item: matched.identity, attempted_lookups: attemptedLookups },
    );
  }

  const timeoutError = new InspireBibtexApiError(
    504,
    "INSPIRE_TIMEOUT",
    `INSPIRE lookup exceeded ${INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs} ms`,
    { item: matched.identity, attempted_lookups: attemptedLookups },
  );
  const circuitOpenError = new InspireBibtexApiError(
    503,
    "INSPIRE_NETWORK_UNAVAILABLE",
    "INSPIRE network access is unavailable while a prior operation or response cleanup is still running",
    { item: matched.identity, attempted_lookups: attemptedLookups },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inspireResult: InspireBibtexSuccessResult | null = null;
  try {
    const task = (async () => {
      let lease: NetworkPipelineLease | undefined;
      try {
        lease = await acquireNetworkSlot(
          controller.signal,
          timeoutError,
          circuitOpenError,
        );

        const recordID = candidate.value;
        const fetched = await fetchBibtexByRecordID(
          recordID,
          controller,
          lease,
        );
        if (!fetched) return null;
        const rewritten = rewriteSingleBibtexEntryKey(
          fetched.text,
          citationKey,
        );
        if (
          utf8ByteLength(rewritten.text) >
          INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes
        ) {
          throw new InspireBibtexApiError(
            502,
            "INSPIRE_BIBTEX_TOO_LARGE",
            `Rewritten INSPIRE BibTeX exceeds ${INSPIRE_BIBTEX_API_LIMITS.maxBibtexEntryBytes} bytes`,
            { item: matched.identity, attempted_lookups: attemptedLookups },
          );
        }
        return {
          citation_key: citationKey,
          status: "ok" as const,
          item: matched.identity,
          source: {
            provider: "INSPIRE-HEP" as const,
            record_id: recordID,
            url: fetched.url,
            lookup: candidate,
          },
          bibtex: {
            text: rewritten.text,
            original_entry_key: rewritten.originalEntryKey,
            entry_key: rewritten.entryKey,
            entry_key_rewritten: rewritten.rewritten,
          },
          field_provenance: {
            citation_key: "request" as const,
            item: "zotero-item" as const,
            "source.lookup": "zotero-item" as const,
            "source.record_id": "zotero-item" as const,
            "bibtex.original_entry_key": "INSPIRE-HEP" as const,
            "bibtex.entry_key": "request" as const,
            "bibtex.text_except_entry_key": "INSPIRE-HEP" as const,
          },
          fields_from_inspire: [
            "bibtex.original_entry_key",
            "bibtex.text_except_entry_key",
          ],
          fields_from_better_bibtex: [],
        };
      } finally {
        if (lease) finishNetworkPipeline(lease);
      }
    })();

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, INSPIRE_BIBTEX_API_LIMITS.networkTimeoutMs);
    });
    inspireResult = await Promise.race([task, timeout]);
  } catch (err) {
    if (err instanceof InspireBibtexApiError) {
      throw new InspireBibtexApiError(err.status, err.code, err.message, {
        ...(err.details || {}),
        item: matched.identity,
        attempted_lookups: attemptedLookups,
      });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (inspireResult) return inspireResult;
  return exportBetterBibtexFallback(
    citationKey,
    matched,
    "INSPIRE_RECORD_NOT_FOUND",
    attemptedLookups,
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return results;
}

function toItemError(
  citationKey: string,
  err: unknown,
  matched?: MatchedZoteroItem,
): InspireBibtexErrorResult {
  if (err instanceof InspireBibtexApiError) {
    const details = err.details || {};
    return {
      citation_key: citationKey,
      status: "error",
      code: err.code,
      error: err.message,
      item:
        (details.item as ZoteroItemIdentity | undefined) || matched?.identity,
      source: details.source as
        | InspireBibtexSuccessResult["source"]
        | undefined,
      attempted_lookups: details.attempted_lookups as
        | InspireLookupDescription[]
        | undefined,
    };
  }
  debug(`Unexpected read-only BibTeX item failure: ${err}`);
  return {
    citation_key: citationKey,
    status: "error",
    code: "INTERNAL_ERROR",
    error: "Unexpected internal failure while processing this citation key",
    item: matched?.identity,
  };
}

export async function buildInspireBibtexBatch(
  citationKeys: string[],
): Promise<InspireBibtexBatchResponse> {
  const lookup = await findItemsByCitationKeys(citationKeys);
  let results = await mapWithConcurrency(
    citationKeys,
    INSPIRE_BIBTEX_API_LIMITS.networkConcurrency,
    async (citationKey): Promise<InspireBibtexItemResult> => {
      const matches = lookup.matches.get(citationKey) || [];
      if (matches.length > 1) {
        return {
          citation_key: citationKey,
          status: "error",
          code: "CITATION_KEY_AMBIGUOUS",
          error: "The citation key identifies more than one Zotero item",
          candidates: matches.map((match) => match.identity),
        };
      }
      if (lookup.resolver.coverage === "degraded") {
        return {
          citation_key: citationKey,
          status: "error",
          code: "CITATION_KEY_LOOKUP_UNAVAILABLE",
          error:
            "Better BibTeX's authoritative citation-key index is unavailable and the Zotero-field fallback cannot establish a unique match",
          ...(matches.length
            ? { candidates: matches.map((match) => match.identity) }
            : {}),
        };
      }
      if (!matches.length) {
        return {
          citation_key: citationKey,
          status: "error",
          code: "CITATION_KEY_NOT_FOUND",
          error: "No regular, non-deleted Zotero item has this citation key",
        };
      }
      try {
        return await fetchAndRewriteForItem(citationKey, matches[0]);
      } catch (err) {
        return toItemError(citationKey, err, matches[0]);
      }
    },
  );

  const mergedParts: string[] = [];
  let mergedBytes = 0;
  results = results.map((result) => {
    if (result.status !== "ok") return result;
    const separatorBytes = mergedParts.length ? 2 : 0;
    const entryBytes = utf8ByteLength(result.bibtex.text);
    if (
      mergedBytes + separatorBytes + entryBytes >
      INSPIRE_BIBTEX_API_LIMITS.maxMergedBibtexBytes
    ) {
      return {
        citation_key: result.citation_key,
        status: "error",
        code: "RESPONSE_LIMIT_EXCEEDED",
        error: `Adding this entry would exceed the ${INSPIRE_BIBTEX_API_LIMITS.maxMergedBibtexBytes}-byte merged BibTeX limit`,
        item: result.item,
        source: result.source,
      };
    }
    mergedBytes += separatorBytes + entryBytes;
    mergedParts.push(result.bibtex.text);
    return result;
  });

  const succeeded = results.filter((result) => result.status === "ok").length;
  const failed = results.length - succeeded;
  const outcome = failed === 0 ? "ok" : succeeded === 0 ? "error" : "partial";
  return {
    ok: outcome === "ok",
    outcome,
    api_version: "1",
    resolver: lookup.resolver,
    summary: { requested: results.length, succeeded, failed },
    results,
    bibtex: mergedParts.join("\n\n"),
  };
}
