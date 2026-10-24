import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { createZToolkit } from "../src/utils/ztoolkit";
import { config } from "../package.json";

afterEach(() => vi.unstubAllGlobals());

it("creates and cleans up UI helpers without registering protocol handlers", () => {
  const dom = new JSDOM("<!DOCTYPE html><body></body>");
  const zotero = { getMainWindow: () => dom.window, debug: vi.fn() };
  const getProtocolHandler = vi.fn(() => {
    throw new Error("Toolkit must not register external protocol handlers");
  });
  vi.stubGlobal("Zotero", zotero);
  vi.stubGlobal("Services", { io: { getProtocolHandler } });
  vi.stubGlobal("__env__", "production");

  const toolkit = createZToolkit();
  expect(toolkit.basicOptions.api.pluginID).toBe(config.addonID);
  expect(toolkit.basicOptions.log.disableConsole).toBe(true);
  expect(toolkit.UI.basicOptions).toBe(toolkit.basicOptions);
  expect(toolkit.ProgressWindow).toBeTypeOf("function");

  const element = toolkit.UI.appendElement(
    { tag: "div" },
    dom.window.document.body,
  );
  expect(dom.window.document.body.contains(element)).toBe(true);
  toolkit.unregisterAll();
  expect(element.isConnected).toBe(false);

  expect(getProtocolHandler).not.toHaveBeenCalled();
  expect(zotero).not.toHaveProperty("_toolkitGlobal");
  for (const unused of ["Prompt", "Menu", "Reader", "Keyboard", "Guide"]) {
    expect(toolkit).not.toHaveProperty(unused);
  }
  dom.window.close();
});
