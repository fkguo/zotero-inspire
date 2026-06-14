// ─────────────────────────────────────────────────────────────────────────────
// connectorWriteApi.test.ts - Unit tests for the external write endpoint
// Token auth, op routing, param validation, and Zotero API wiring are exercised
// against a mocked Zotero global (no live Zotero / connector server required).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/utils/externalToken", () => ({
  ensureExternalToken: () => "SECRET-TOKEN",
}));

import {
  dispatchWriteOp,
  registerZInspireWriteEndpoint,
  unregisterZInspireWriteEndpoint,
} from "../src/modules/connectorWriteApi";

type ParsedResult = { status: number; body: any };

function parse(result: [number, string, string]): ParsedResult {
  const [status, contentType, body] = result;
  expect(contentType).toBe("application/json");
  return { status, body: JSON.parse(body) };
}

function makeFile(opts: { exists?: boolean; isFile?: boolean; path?: string } = {}) {
  return {
    exists: () => opts.exists ?? true,
    isFile: () => opts.isFile ?? true,
    path: opts.path ?? "/abs/paper.pdf",
  };
}

function makeRegularItem(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    key: "PARENT01",
    isRegularItem: () => true,
    eraseTx: vi.fn(async () => true),
    ...overrides,
  };
}

let linkFromFile: ReturnType<typeof vi.fn>;
let importFromFile: ReturnType<typeof vi.fn>;
let trashTx: ReturnType<typeof vi.fn>;
let getByLibraryAndKeyAsync: ReturnType<typeof vi.fn>;
let pathToFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  linkFromFile = vi.fn(async () => ({ id: 99, key: "ATTACH99", attachmentLinkMode: 2 }));
  importFromFile = vi.fn(async () => ({ id: 100, key: "ATTACH100", attachmentLinkMode: 0 }));
  trashTx = vi.fn(async () => undefined);
  getByLibraryAndKeyAsync = vi.fn(async (_lib: number, _key: string) => makeRegularItem());
  pathToFile = vi.fn((_p: string) => makeFile());

  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Libraries: { userLibraryID: 1 },
    Items: { getByLibraryAndKeyAsync, trashTx },
    Attachments: { linkFromFile, importFromFile },
    File: { pathToFile },
    Server: { Endpoints: {} as Record<string, any> },
  });
});

afterEach(() => {
  // Reset the module-level `registered` singleton so each test starts clean
  // (the Zotero.Server.Endpoints mock is recreated per test). Must run while
  // Zotero is still stubbed, before unstubbing globals.
  unregisterZInspireWriteEndpoint();
  vi.unstubAllGlobals();
});

describe("dispatchWriteOp: ping", () => {
  it("reports capabilities and version", async () => {
    const { status, body } = parse(await dispatchWriteOp({ op: "ping" }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.op).toBe("ping");
    expect(body.capabilities).toEqual(
      expect.arrayContaining(["attach_file", "trash_item", "erase_item"]),
    );
    expect(typeof body.version).toBe("string");
  });
});

describe("dispatchWriteOp: unknown / missing op", () => {
  it("rejects unknown op with 400", async () => {
    const { status, body } = parse(await dispatchWriteOp({ op: "frobnicate" }));
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Unknown op");
  });

  it("rejects missing op with 400", async () => {
    const { status, body } = parse(await dispatchWriteOp({}));
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });
});

describe("dispatchWriteOp: attach_file", () => {
  it("links a local file to the parent item (default mode)", async () => {
    const { status, body } = parse(
      await dispatchWriteOp({
        op: "attach_file",
        parent_item_key: "PARENT01",
        file_path: "/abs/paper.pdf",
      }),
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("link");
    expect(body.attachment_key).toBe("ATTACH99");
    expect(body.link_mode_label).toBe("linked_file");
    expect(linkFromFile).toHaveBeenCalledTimes(1);
    expect(importFromFile).not.toHaveBeenCalled();
    const opts = linkFromFile.mock.calls[0][0];
    expect(opts.parentItemID).toBe(42);
    expect(opts.file).toBeDefined();
  });

  it("imports (copies) the file when mode=import", async () => {
    const { status, body } = parse(
      await dispatchWriteOp({
        op: "attach_file",
        parent_item_key: "PARENT01",
        file_path: "/abs/paper.pdf",
        mode: "import",
      }),
    );
    expect(status).toBe(200);
    expect(body.mode).toBe("import");
    expect(body.link_mode_label).toBe("imported_file");
    expect(importFromFile).toHaveBeenCalledTimes(1);
    expect(linkFromFile).not.toHaveBeenCalled();
  });

  it("passes through optional title and content_type", async () => {
    await dispatchWriteOp({
      op: "attach_file",
      parent_item_key: "PARENT01",
      file_path: "/abs/paper.pdf",
      title: "Main PDF",
      content_type: "application/pdf",
    });
    const opts = linkFromFile.mock.calls[0][0];
    expect(opts.title).toBe("Main PDF");
    expect(opts.contentType).toBe("application/pdf");
  });

  it("requires parent_item_key", async () => {
    const { status, body } = parse(
      await dispatchWriteOp({ op: "attach_file", file_path: "/abs/paper.pdf" }),
    );
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PARAMS");
    expect(linkFromFile).not.toHaveBeenCalled();
  });

  it("requires file_path", async () => {
    const { status, body } = parse(
      await dispatchWriteOp({ op: "attach_file", parent_item_key: "PARENT01" }),
    );
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PARAMS");
  });

  it("404 when parent item is not found", async () => {
    getByLibraryAndKeyAsync.mockResolvedValueOnce(false);
    const { status, body } = parse(
      await dispatchWriteOp({
        op: "attach_file",
        parent_item_key: "MISSING",
        file_path: "/abs/paper.pdf",
      }),
    );
    expect(status).toBe(404);
    expect(body.code).toBe("ITEM_NOT_FOUND");
  });

  it("400 when parent is not a regular item", async () => {
    getByLibraryAndKeyAsync.mockResolvedValueOnce(
      makeRegularItem({ isRegularItem: () => false }),
    );
    const { status, body } = parse(
      await dispatchWriteOp({
        op: "attach_file",
        parent_item_key: "PARENT01",
        file_path: "/abs/paper.pdf",
      }),
    );
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PARENT");
  });

  it("404 when file does not exist", async () => {
    pathToFile.mockReturnValueOnce(makeFile({ exists: false }));
    const { status, body } = parse(
      await dispatchWriteOp({
        op: "attach_file",
        parent_item_key: "PARENT01",
        file_path: "/abs/missing.pdf",
      }),
    );
    expect(status).toBe(404);
    expect(body.code).toBe("FILE_NOT_FOUND");
  });

  it("400 when path is invalid / relative", async () => {
    pathToFile.mockImplementationOnce(() => {
      throw new Error("not absolute");
    });
    const { status, body } = parse(
      await dispatchWriteOp({
        op: "attach_file",
        parent_item_key: "PARENT01",
        file_path: "relative/paper.pdf",
      }),
    );
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PATH");
  });
});

describe("dispatchWriteOp: trash_item", () => {
  it("trashes an item by key", async () => {
    const { status, body } = parse(
      await dispatchWriteOp({ op: "trash_item", item_key: "PARENT01" }),
    );
    expect(status).toBe(200);
    expect(body.trashed).toBe(true);
    expect(trashTx).toHaveBeenCalledWith(42);
  });

  it("requires item_key", async () => {
    const { status, body } = parse(await dispatchWriteOp({ op: "trash_item" }));
    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_PARAMS");
    expect(trashTx).not.toHaveBeenCalled();
  });

  it("404 when item not found", async () => {
    getByLibraryAndKeyAsync.mockResolvedValueOnce(false);
    const { status, body } = parse(
      await dispatchWriteOp({ op: "trash_item", item_key: "MISSING" }),
    );
    expect(status).toBe(404);
    expect(body.code).toBe("ITEM_NOT_FOUND");
  });
});

describe("dispatchWriteOp: erase_item", () => {
  it("permanently erases an item by key", async () => {
    const item = makeRegularItem();
    getByLibraryAndKeyAsync.mockResolvedValueOnce(item);
    const { status, body } = parse(
      await dispatchWriteOp({ op: "erase_item", item_key: "PARENT01" }),
    );
    expect(status).toBe(200);
    expect(body.erased).toBe(true);
    expect(item.eraseTx).toHaveBeenCalledTimes(1);
  });
});

describe("library_id resolution", () => {
  it("defaults to the user library when omitted", async () => {
    await dispatchWriteOp({ op: "trash_item", item_key: "PARENT01" });
    expect(getByLibraryAndKeyAsync).toHaveBeenCalledWith(1, "PARENT01");
  });

  it("honors an explicit numeric library_id", async () => {
    await dispatchWriteOp({ op: "trash_item", item_key: "PARENT01", library_id: 7 });
    expect(getByLibraryAndKeyAsync).toHaveBeenCalledWith(7, "PARENT01");
  });
});

describe("endpoint token auth (init)", () => {
  function getEndpoint() {
    registerZInspireWriteEndpoint();
    const Endpoint = (Zotero as any).Server.Endpoints["/connector/zinspireWrite"];
    return new Endpoint();
  }

  it("rejects requests without the token (403)", async () => {
    const ep = getEndpoint();
    const { status, body } = parse(await ep.init({ headers: {}, data: { op: "ping" } }));
    expect(status).toBe(403);
    expect(body.error).toBe("FORBIDDEN");
  });

  it("rejects requests with a wrong token (403)", async () => {
    const ep = getEndpoint();
    const { status } = parse(
      await ep.init({ headers: { "x-zinspire-token": "WRONG" }, data: { op: "ping" } }),
    );
    expect(status).toBe(403);
  });

  it("accepts requests with the correct token", async () => {
    const ep = getEndpoint();
    const { status, body } = parse(
      await ep.init({
        headers: { "x-zinspire-token": "SECRET-TOKEN" },
        data: { op: "ping" },
      }),
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
