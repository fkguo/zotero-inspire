import type { NativeOverlayMatchPackage } from "./nativeOverlayTypes";

const MAX_GLOBAL_RECORDS = 132_000;
const MAX_GLOBAL_TEXT_UNITS = 8_000_000;

export interface OverlayMemoryCharge {
  records: number;
  textUnits: number;
}

/** Aggregate accounting makes every completed-map release O(1). */
export class OverlayMemoryAccountant {
  private records = 0;
  private textUnits = 0;

  reserveCompletedMap(
    nativePackage: NativeOverlayMatchPackage,
    current?: OverlayMemoryCharge,
  ): OverlayMemoryCharge | undefined {
    const charge = measureCompletedMap(nativePackage);
    return this.resize(current, charge);
  }

  reserveBuild(
    current: OverlayMemoryCharge | undefined,
    records: number,
    textUnits: number,
  ): OverlayMemoryCharge | undefined {
    return this.resize(current, { records, textUnits });
  }

  private resize(
    current: OverlayMemoryCharge | undefined,
    charge: OverlayMemoryCharge,
  ): OverlayMemoryCharge | undefined {
    const baseRecords = this.records - (current?.records || 0);
    const baseTextUnits = this.textUnits - (current?.textUnits || 0);
    if (
      baseRecords + charge.records > MAX_GLOBAL_RECORDS ||
      baseTextUnits + charge.textUnits > MAX_GLOBAL_TEXT_UNITS
    ) {
      return undefined;
    }
    this.records = baseRecords + charge.records;
    this.textUnits = baseTextUnits + charge.textUnits;
    return charge;
  }

  release(charge: OverlayMemoryCharge | undefined): void {
    if (!charge) return;
    this.records = Math.max(0, this.records - charge.records);
    this.textUnits = Math.max(0, this.textUnits - charge.textUnits);
  }

  reset(): void {
    this.records = 0;
    this.textUnits = 0;
  }

  snapshot(): Readonly<OverlayMemoryCharge> {
    return { records: this.records, textUnits: this.textUnits };
  }
}

function measureCompletedMap(
  nativePackage: NativeOverlayMatchPackage,
): OverlayMemoryCharge {
  let records = 0;
  let textUnits = 0;
  for (const [label, tokens] of nativePackage.tokenMap) {
    records++;
    textUnits += label.length;
    for (const token of tokens) {
      records++;
      if (token.arxiv) {
        records++;
        textUnits += token.arxiv.length;
      }
      if (token.doi) {
        records++;
        textUnits += token.doi.length;
      }
      if (token.exactJournalKey) {
        records++;
        textUnits += token.exactJournalKey.length;
      }
      if (token.genericJournal) {
        records += 3;
        textUnits +=
          token.genericJournal.journal.length +
          token.genericJournal.volume.length +
          token.genericJournal.page.length;
      }
    }
  }
  return { records, textUnits };
}
