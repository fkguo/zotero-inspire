import { afterEach, describe, expect, it, vi } from "vitest";
import { firstPdfAttachmentID } from "../src/modules/inspire/library/localPdf";

// The first PDF of a library item, for the green PDF buttons of the
// References panel and the arXiv browser.

afterEach(() => vi.unstubAllGlobals());

function unloaded(message: string) {
  const err = new Error(message);
  err.name = "UnloadedDataException";
  return err;
}

describe("firstPdfAttachmentID", () => {
  it("gives the item's first PDF attachment", () => {
    const items: Record<number, object> = {
      1: { getAttachments: () => [2, 3] },
      2: { isPDFAttachment: () => false },
      3: { isPDFAttachment: () => true },
    };
    vi.stubGlobal("Zotero", { Items: { get: (id: number) => items[id] } });
    expect(firstPdfAttachmentID(1)).toBe(3);
  });

  it("gives none, without an error, while the item's library is being loaded (the item is there before its attachments)", () => {
    vi.stubGlobal("Zotero", {
      Items: {
        get: () => ({
          getAttachments: () => {
            throw unloaded("'childItems' not loaded for item (5/1/KEY)");
          },
        }),
      },
    });
    expect(firstPdfAttachmentID(5)).toBeNull();
  });

  it("gives none for an item of a library not loaded yet", () => {
    vi.stubGlobal("Zotero", {
      Items: {
        get: () => {
          throw unloaded("Item 5 not yet loaded");
        },
      },
    });
    expect(firstPdfAttachmentID(5)).toBeNull();
  });
});
