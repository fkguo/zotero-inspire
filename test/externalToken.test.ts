import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPref: vi.fn(),
  setPref: vi.fn(),
}));

vi.mock("../src/utils/prefs", () => ({
  getPref: mocks.getPref,
  setPref: mocks.setPref,
}));

import {
  ensureExternalReadToken,
  ensureExternalToken,
  getExternalReadToken,
  getExternalToken,
  readExternalReadToken,
} from "../src/utils/externalToken";

describe("external integration tokens", () => {
  const existingReadToken = "R".repeat(43);
  const prefs = new Map<string, unknown>();
  let randomByte = 0;

  beforeEach(() => {
    prefs.clear();
    randomByte = 0;
    mocks.getPref.mockReset();
    mocks.setPref.mockReset();
    mocks.getPref.mockImplementation((key: string) => prefs.get(key));
    mocks.setPref.mockImplementation((key: string, value: unknown) => {
      prefs.set(key, value);
    });
    vi.stubGlobal("Zotero", { debug: vi.fn() });
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        randomByte++;
        bytes.fill(randomByte);
        return bytes;
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates separate stable tokens for read-only and write access", () => {
    const writeToken = ensureExternalToken();
    const readToken = ensureExternalReadToken();

    expect(writeToken).not.toBe(readToken);
    expect(ensureExternalToken()).toBe(writeToken);
    expect(ensureExternalReadToken()).toBe(readToken);
    expect(mocks.setPref.mock.calls.map((call) => call[0])).toEqual([
      "external_token",
      "external_read_token",
    ]);
  });

  it("reads the existing read token without mutating preferences", () => {
    prefs.set("external_read_token", `  ${existingReadToken}  `);

    expect(readExternalReadToken()).toBe(existingReadToken);
    expect(mocks.setPref).not.toHaveBeenCalled();
  });

  it("fails closed on a missing read token until startup initializes it", () => {
    expect(readExternalReadToken()).toBeNull();
    expect(mocks.setPref).not.toHaveBeenCalled();

    const initialized = getExternalReadToken();
    expect(initialized).toBeTruthy();
    expect(readExternalReadToken()).toBe(initialized);
    expect(mocks.setPref).toHaveBeenCalledOnce();
  });

  it("uses CSPRNG output for a newly generated read token", () => {
    const randomSpy = vi.spyOn(Math, "random");

    const token = ensureExternalReadToken();

    expect(token).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
    expect(randomSpy).not.toHaveBeenCalled();
    expect(mocks.setPref).toHaveBeenCalledWith("external_read_token", token);
  });

  it("does not create authentication tokens when CSPRNG is unavailable", () => {
    const randomSpy = vi.spyOn(Math, "random");
    vi.stubGlobal("crypto", undefined);

    expect(ensureExternalReadToken()).toBeNull();
    expect(ensureExternalToken()).toBeNull();
    expect(readExternalReadToken()).toBeNull();
    expect(randomSpy).not.toHaveBeenCalled();
    expect(mocks.setPref).not.toHaveBeenCalled();
  });

  it("uses the Zotero main-window CSPRNG when the sandbox lacks one", () => {
    vi.stubGlobal("crypto", undefined);
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(7);
      return bytes;
    });
    (Zotero as any).getMainWindow = () => ({
      crypto: { getRandomValues },
    });

    expect(ensureExternalReadToken()).toBe(
      "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
    );
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("does not create a read token when CSPRNG throws", () => {
    const randomSpy = vi.spyOn(Math, "random");
    vi.stubGlobal("crypto", {
      getRandomValues: vi.fn(() => {
        throw new Error("CSPRNG unavailable");
      }),
    });

    expect(ensureExternalReadToken()).toBeNull();
    expect(readExternalReadToken()).toBeNull();
    expect(randomSpy).not.toHaveBeenCalled();
    expect(mocks.setPref).not.toHaveBeenCalled();
  });

  it("returns an existing read token without consulting CSPRNG", () => {
    const getRandomValues = vi.fn(() => {
      throw new Error("must not be called");
    });
    vi.stubGlobal("crypto", { getRandomValues });
    prefs.set("external_read_token", `  ${existingReadToken}  `);

    expect(ensureExternalReadToken()).toBe(existingReadToken);
    expect(getExternalReadToken()).toBe(existingReadToken);
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(mocks.setPref).not.toHaveBeenCalled();
  });

  it("replaces a legacy weak read token with a fresh CSPRNG token", () => {
    prefs.set("external_read_token", "old.weak.token");

    const token = ensureExternalReadToken();

    expect(token).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
    expect(mocks.setPref).toHaveBeenCalledWith("external_read_token", token);
    expect(readExternalReadToken()).toBe(token);
  });

  it("replaces a legacy weak write token with a fresh CSPRNG token", () => {
    prefs.set("external_token", "old.weak.token");

    const token = ensureExternalToken();

    expect(token).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
    expect(mocks.setPref).toHaveBeenCalledWith("external_token", token);
    expect(getExternalToken()).toBe(token);
  });

  it("rejects a weak legacy write token when CSPRNG is unavailable", () => {
    prefs.set("external_token", "old.weak.token");
    vi.stubGlobal("crypto", undefined);

    expect(ensureExternalToken()).toBeNull();
    expect(getExternalToken()).toBeNull();
    expect(prefs.get("external_token")).toBe("old.weak.token");
    expect(mocks.setPref).not.toHaveBeenCalled();
  });

  it("applies the same strict token format to read and write preferences", () => {
    prefs.set("external_token", "W".repeat(42));
    prefs.set("external_read_token", `${"R".repeat(42)}.`);

    const writeToken = ensureExternalToken();
    const readToken = ensureExternalReadToken();

    expect(writeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.setPref.mock.calls.map((call) => call[0])).toEqual([
      "external_token",
      "external_read_token",
    ]);
  });
});
