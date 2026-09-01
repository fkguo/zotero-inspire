import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureExternalToken: vi.fn(),
}));

vi.mock("../src/utils/externalToken", () => ({
  ensureExternalToken: mocks.ensureExternalToken,
}));

vi.mock("../src/utils/zoteroPaneSelection", () => ({
  getPrimarySelectedCollection: vi.fn(() => null),
  getPrimarySelectedLibraryID: vi.fn(() => null),
}));

vi.mock("../src/modules/pickerUI", () => ({
  showTargetPickerUI: vi.fn(),
}));

import {
  registerZInspirePickSaveTargetEndpoint,
  unregisterZInspirePickSaveTargetEndpoint,
} from "../src/modules/connectorPickSaveTarget";

type EndpointResult = [number, string, string];

function parse(result: EndpointResult): { status: number; body: any } {
  expect(result[1]).toBe("application/json");
  return { status: result[0], body: JSON.parse(result[2]) };
}

function endpoint(): {
  init(request: {
    headers: Record<string, string>;
    data: unknown;
  }): Promise<EndpointResult>;
} {
  registerZInspirePickSaveTargetEndpoint();
  const Endpoint = (Zotero as any).Server.Endpoints[
    "/connector/zinspirePickSaveTarget"
  ];
  return new Endpoint();
}

beforeEach(() => {
  mocks.ensureExternalToken.mockReset();
  mocks.ensureExternalToken.mockReturnValue("SECRET-TOKEN");
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Server: { Endpoints: {} },
    getMainWindow: vi.fn(() => {
      throw new Error("private window failure");
    }),
  });
});

afterEach(() => {
  unregisterZInspirePickSaveTargetEndpoint();
  vi.unstubAllGlobals();
});

describe("save-target connector safety", () => {
  it("fails closed when a secure write token is unavailable", async () => {
    mocks.ensureExternalToken.mockReturnValue(null);
    const { status, body } = parse(
      await endpoint().init({ headers: {}, data: { wait: false } }),
    );

    expect(status).toBe(503);
    expect(body.error).toBe("TOKEN_UNAVAILABLE");
    expect((Zotero as any).getMainWindow).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["incorrect", { "x-zinspire-token": "WRONG" }],
  ])("rejects a %s write token", async (_label, headers) => {
    const { status, body } = parse(
      await endpoint().init({ headers, data: { wait: false } }),
    );

    expect(status).toBe(403);
    expect(body.error).toBe("FORBIDDEN");
    expect((Zotero as any).getMainWindow).not.toHaveBeenCalled();
  });

  it("rejects an oversized request ID without reflecting or opening the picker", async () => {
    const requestID = "X".repeat(2 * 1024 * 1024);
    const result = await endpoint().init({
      headers: { "x-zinspire-token": "SECRET-TOKEN" },
      data: { requestID },
    });
    const { status, body } = parse(result);

    expect(status).toBe(400);
    expect(body.error).toBe("INVALID_REQUEST_ID");
    expect(result[2].length).toBeLessThan(1024);
    expect(result[2]).not.toContain(requestID);
    expect((Zotero as any).getMainWindow).not.toHaveBeenCalled();
  });

  it("does not expose an asynchronous picker exception through polling", async () => {
    const started = parse(
      await endpoint().init({
        headers: { "x-zinspire-token": "SECRET-TOKEN" },
        data: { wait: false },
      }),
    );
    expect(started.status).toBe(200);
    await Promise.resolve();
    await Promise.resolve();

    const polled = parse(
      await endpoint().init({
        headers: { "x-zinspire-token": "SECRET-TOKEN" },
        data: { requestID: started.body.requestID },
      }),
    );
    expect(polled.body).toMatchObject({
      status: "error",
      error: "Save-target selection failed",
    });
    expect(JSON.stringify(polled.body)).not.toContain("private window failure");
  });
});

describe("save-target endpoint registration ownership", () => {
  const path = "/connector/zinspirePickSaveTarget";

  it("restores an existing endpoint, including a falsey owner", () => {
    (Zotero as any).Server.Endpoints[path] = null;
    registerZInspirePickSaveTargetEndpoint();
    expect((Zotero as any).Server.Endpoints[path]).not.toBeNull();

    unregisterZInspirePickSaveTargetEndpoint();
    expect(
      Object.prototype.hasOwnProperty.call(
        (Zotero as any).Server.Endpoints,
        path,
      ),
    ).toBe(true);
    expect((Zotero as any).Server.Endpoints[path]).toBeNull();
  });

  it("does not clobber an endpoint installed by a later owner", () => {
    registerZInspirePickSaveTargetEndpoint();
    const laterOwner = class LaterOwner {};
    (Zotero as any).Server.Endpoints[path] = laterOwner;

    unregisterZInspirePickSaveTargetEndpoint();
    expect((Zotero as any).Server.Endpoints[path]).toBe(laterOwner);
  });
});
