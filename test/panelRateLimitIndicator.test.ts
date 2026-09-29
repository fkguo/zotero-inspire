import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { config } from "../package.json";
import { InspireReferencePanelController } from "../src/modules/zinspire";

// The toolbar of the References panel has two symbols: the quick-filter
// button (⏳) and the INSPIRE request-queue indicator (🚦 with a short phrase
// and the number of queued requests). They must not share a symbol. The panel
// is built by its constructor on jsdom, with a stand-in for the part of
// zotero-plugin-toolkit's element builder that it uses; its strings come from
// the real addon.ftl files.

function buildElement(doc: Document, spec: any): Element {
  const el =
    spec.namespace === "svg"
      ? doc.createElementNS("http://www.w3.org/2000/svg", spec.tag)
      : doc.createElement(spec.tag);
  if (spec.id) el.id = spec.id;
  for (const name of spec.classList ?? []) el.classList.add(name);
  for (const [key, value] of Object.entries(spec.attributes ?? {})) {
    if (value !== undefined) el.setAttribute(key, String(value));
  }
  for (const [key, value] of Object.entries(spec.properties ?? {})) {
    (el as any)[key] = value;
  }
  for (const [key, value] of Object.entries(spec.styles ?? {})) {
    (el as any).style[key] = value;
  }
  for (const { type, listener, options } of spec.listeners ?? []) {
    el.addEventListener(type, listener, options);
  }
  for (const child of spec.children ?? []) {
    el.appendChild(buildElement(doc, child));
  }
  return el;
}

/** Render a one-line message of an addon.ftl with its { $name } arguments. */
function ftlLocale(locale: string) {
  const text = readFileSync(
    new URL(`../addon/locale/${locale}/addon.ftl`, import.meta.url),
    "utf8",
  );
  return {
    formatMessagesSync: ([{ id, args }]: Array<{
      id: string;
      args?: Record<string, unknown>;
    }>) => {
      const key = id.slice(config.addonRef.length + 1);
      const line = text.split("\n").find((l) => l.startsWith(`${key} = `));
      const value = line
        ?.slice(key.length + 3)
        .replace(/\{ \$(\w+) \}/g, (_, name) => String(args?.[name]));
      return [{ value: value ?? id }];
    },
  };
}

describe("References panel request-queue indicator", () => {
  let controller: any;

  function buildPanel(locale: string) {
    const dom = new JSDOM(
      "<!DOCTYPE html><body><div class='pane'></div></body>",
      { url: "https://zotero.test/" },
    );
    const win = dom.window as any;
    const doc = win.document as Document;
    vi.stubGlobal("Zotero", {
      debug: vi.fn(),
      Prefs: { get: () => undefined, set: vi.fn() },
      getMainWindow: () => win,
      Notifier: {
        registerObserver: () => "observer",
        unregisterObserver: vi.fn(),
      },
      Items: { get: () => null },
    });
    vi.stubGlobal("addon", {
      data: { locale: { current: ftlLocale(locale) } },
    });
    vi.stubGlobal("ztoolkit", {
      UI: {
        appendElement: (spec: any, parent: Element) =>
          parent.appendChild(buildElement(doc, spec)),
      },
      getGlobal: (name: string) => win[name],
    });
    controller = new InspireReferencePanelController(
      doc.querySelector(".pane") as HTMLDivElement,
    );
  }

  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
  });

  it("shows 🚦 with the queued count, while the filter button keeps ⏳", () => {
    buildPanel("en-US");
    const indicator = controller.rateLimiterStatusEl as HTMLSpanElement;
    expect(indicator.hidden).toBe(true);

    controller.updateRateLimiterStatus({
      queuedCount: 3,
      availableTokens: 0,
      isThrottling: true,
      timeUntilNextToken: 800,
    });
    expect(indicator.hidden).toBe(false);
    expect(indicator.textContent).toBe("🚦 INSPIRE queue: 3");

    const filterButton = controller.quickFiltersControl.element.querySelector(
      ".zinspire-quick-filter-btn",
    ) as HTMLButtonElement;
    expect(filterButton.firstChild?.textContent).toBe("⏳");

    controller.updateRateLimiterStatus({
      queuedCount: 0,
      availableTokens: 15,
      isThrottling: false,
      timeUntilNextToken: 0,
    });
    expect(indicator.hidden).toBe(true);
  });

  it("reads 🚦 INSPIRE 排队 3 in Chinese", () => {
    buildPanel("zh-CN");
    controller.updateRateLimiterStatus({
      queuedCount: 3,
      availableTokens: 0,
      isThrottling: true,
      timeUntilNextToken: 800,
    });
    expect(controller.rateLimiterStatusEl.textContent).toBe(
      "🚦 INSPIRE 排队 3",
    );
  });
});
