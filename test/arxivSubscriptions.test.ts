import { readFileSync } from "node:fs";
import {
  FluentParser,
  Message,
  NumberLiteral,
  Placeable,
  SelectExpression,
  TextElement,
  VariableReference,
} from "@fluent/syntax";
import { JSDOM, type DOMWindow } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../package.json";
import {
  defaultSubscription,
  isWholeArchive,
  loadSubscriptions,
  normalizeCategories,
  saveSubscriptions,
  type ArxivSubscription,
} from "../src/modules/arxiv/browser/subscriptions";
import {
  formatDuration,
  SubscriptionEditor,
} from "../src/modules/arxiv/browser/SubscriptionEditor";
import { SubscriptionBar } from "../src/modules/arxiv/browser/SubscriptionBar";

// Subscriptions of the arXiv browser: how their categories are stored, the
// editor with its category tree, and the bar that chooses, makes, changes and
// deletes them. Preferences live in `prefs`; getString() returns the message
// ID with its arguments.

let win: DOMWindow;
let prefs: Record<string, unknown>;

const PREFIX = config.prefsPrefix;

beforeEach(() => {
  win = new JSDOM(
    "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
    { url: "https://zotero.test/" },
  ).window;
  prefs = {};
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    Prefs: {
      get: (key: string) => prefs[key],
      set: (key: string, value: unknown) => {
        prefs[key] = value;
      },
    },
  });
  vi.stubGlobal("addon", {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id, args }]: Array<{
            id: string;
            args?: Record<string, unknown>;
          }>) => [{ value: args ? `${id} ${JSON.stringify(args)}` : id }],
        },
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function msg(key: string, args?: Record<string, unknown>) {
  const id = `${config.addonRef}-${key}`;
  return args ? `${id} ${JSON.stringify(args)}` : id;
}

function stored(): ArxivSubscription[] {
  return JSON.parse(String(prefs[`${PREFIX}.arxiv_subscriptions`]));
}

function subscription(
  fields: Partial<ArxivSubscription> = {},
): ArxivSubscription {
  return {
    id: "sub-1",
    name: "Daily",
    categories: ["hep-ph", "hep-lat"],
    sections: { new: true, cross: true, replace: false },
    ...fields,
  };
}

describe("stored categories", () => {
  it("keep the user's order, with aliases under their canonical names", () => {
    expect(
      normalizeCategories(["nucl-th", "math.MP", "hep-ph", "stat.TH"]),
    ).toEqual(["nucl-th", "math-ph", "hep-ph", "math.ST"]);
  });

  it("drop repeats (also an alias of a chosen category) and unknown names", () => {
    expect(
      normalizeCategories(["hep-ph", "math-ph", "math.MP", "hep-ph", "hep-xx"]),
    ).toEqual(["hep-ph", "math-ph"]);
  });

  it("drop the categories listed on the page of an archive taken as a whole", () => {
    expect(
      normalizeCategories(["math.AG", "hep-th", "math", "math.CO"]),
    ).toEqual(["hep-th", "math"]);
    // Also through an alias: the math page lists math-ph (math.MP) and
    // cs.IT (math.IT), the cs page lists math.NA (cs.NA)
    expect(normalizeCategories(["math.MP", "cs.IT", "math"])).toEqual(["math"]);
    expect(normalizeCategories(["math.NA", "cs"])).toEqual(["cs"]);
    expect(normalizeCategories(["math-ph", "cs"])).toEqual(["math-ph", "cs"]);
    // Archives of one category (math-ph, hep-ph) are categories
    expect(isWholeArchive("math")).toBe(true);
    expect(isWholeArchive("hep-ph")).toBe(false);
    expect(isWholeArchive("math-ph")).toBe(false);
  });

  it("are saved and read back as JSON in the preferences", () => {
    saveSubscriptions([subscription()]);
    expect(loadSubscriptions()).toEqual([subscription()]);
    prefs[`${PREFIX}.arxiv_subscriptions`] = "not json";
    expect(loadSubscriptions()).toEqual([]);
  });

  it("start the window with the default subscription, else the first", () => {
    const list = [subscription(), subscription({ id: "sub-2" })];
    expect(defaultSubscription(list)?.id).toBe("sub-1");
    prefs[`${PREFIX}.arxiv_browser_default_subscription`] = "sub-2";
    expect(defaultSubscription(list)?.id).toBe("sub-2");
    prefs[`${PREFIX}.arxiv_browser_default_subscription`] = "gone";
    expect(defaultSubscription(list)?.id).toBe("sub-1");
    expect(defaultSubscription([])).toBeUndefined();
  });
});

describe("subscription editor", () => {
  function open(fields: Partial<{ subscription: ArxivSubscription }> = {}) {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const editor = new SubscriptionEditor(
      win.document.getElementById("root")!,
      { defaultName: "Subscription 1", onSave, onClose, ...fields },
    );
    const rows = () =>
      [
        ...editor.panel.querySelectorAll(".arxiv-browser__editor-row"),
      ] as HTMLLabelElement[];
    const row = (text: string) =>
      rows().find((label) => label.textContent!.startsWith(text))!;
    const box = (text: string) => row(text).querySelector("input")!;
    const click = (text: string) => box(text).click();
    const saveButton = () =>
      [...editor.panel.querySelectorAll("button")].find(
        (b) => b.textContent === msg("arxiv-browser-editor-save"),
      )!;
    return { editor, onSave, onClose, rows, row, box, click, saveButton };
  }

  it("lists arXiv's categories by group and archive, whole archives where they have several", () => {
    const { editor, rows } = open();
    const groups = editor.panel.querySelectorAll(
      ".arxiv-browser__editor-tree > details > summary",
    );
    expect([...groups].map((g) => g.textContent)).toEqual([
      "Computer Science",
      "Economics",
      "Electrical Engineering and Systems Science",
      "Mathematics",
      "Physics",
      "Quantitative Biology",
      "Quantitative Finance",
      "Statistics",
    ]);
    const labels = rows().map((row) => row.textContent);
    // 155 categories and the 11 archives with several categories
    expect(labels).toHaveLength(155 + 11);
    expect(
      labels.filter((text) =>
        text!.startsWith(
          msg("arxiv-browser-editor-whole-archive").slice(0, 10),
        ),
      ),
    ).toHaveLength(11);
    expect(labels).toContain("hep-ph — High Energy Physics - Phenomenology");
  });

  it("puts an archive of one category directly under its group", () => {
    const { row } = open();
    const summaryOf = (element: Element | null) =>
      element?.querySelector(":scope > summary")?.textContent;
    // hep-ph: Physics › hep-ph; math.AG: Mathematics › Mathematics (math) › math.AG
    expect(summaryOf(row("hep-ph").parentElement)).toBe("Physics");
    expect(summaryOf(row("math.AG").parentElement)).toBe("Mathematics (math)");
    expect(summaryOf(row("math.AG").parentElement!.parentElement)).toBe(
      "Mathematics",
    );
  });

  it("stores an alias under its canonical name and shows both rows chosen", () => {
    const { editor, box, click } = open();
    click("math.MP");
    expect(editor.getSelected()).toEqual(["math-ph"]);
    expect(box("math.MP").checked).toBe(true);
    expect(box("math-ph").checked).toBe(true);
    click("math-ph");
    expect(editor.getSelected()).toEqual([]);
    expect(box("math.MP").checked).toBe(false);
  });

  it("takes an archive as a whole, its categories then included", () => {
    const { editor, box, click } = open();
    click("math.AG");
    click("hep-th");
    click(
      msg("arxiv-browser-editor-whole-archive", { archive: "math", count: 32 }),
    );
    expect(editor.getSelected()).toEqual(["hep-th", "math"]);
    expect([box("math.AG").checked, box("math.AG").disabled]).toEqual([
      true,
      true,
    ]);
    // The math page lists math-ph too (its alias math.MP is in math)
    expect([box("math-ph").checked, box("math-ph").disabled]).toEqual([
      true,
      true,
    ]);
    expect(box("hep-th").disabled).toBe(false);
    click("math.MP");
    expect(editor.getSelected()).toEqual(["hep-th", "math"]);
  });

  it("finds categories by identifier or name and opens their groups", () => {
    const { editor, rows } = open();
    const search = editor.panel.querySelector(
      ".arxiv-browser__editor-search",
    ) as HTMLInputElement;
    search.value = "phenomenology";
    search.dispatchEvent(new win.Event("input"));
    const shown = () =>
      rows()
        .filter((row) => !row.hidden)
        .map((row) => row.textContent);
    expect(shown()).toEqual(["hep-ph — High Energy Physics - Phenomenology"]);
    search.value = "NLIN.cg";
    search.dispatchEvent(new win.Event("input"));
    expect(shown()).toEqual(["nlin.CG — Cellular Automata and Lattice Gases"]);
    search.value = "phenomenology";
    search.dispatchEvent(new win.Event("input"));
    const physics = [
      ...editor.panel.querySelectorAll(".arxiv-browser__editor-tree > details"),
    ].find(
      (d) => d.querySelector("summary")!.textContent === "Physics",
    ) as HTMLDetailsElement;
    expect(physics.open).toBe(true);
    expect(physics.hidden).toBe(false);
    search.value = "";
    search.dispatchEvent(new win.Event("input"));
    expect(rows().every((row) => !row.hidden)).toBe(true);
    expect(physics.open).toBe(false);
  });

  it("orders the chosen categories as the user wants", () => {
    const { editor, click } = open();
    click("hep-ph");
    click("hep-lat");
    click("nucl-th");
    const moveUp = editor.panel.querySelectorAll(
      ".arxiv-browser__editor-chosen button",
    )[3] as HTMLButtonElement; // ↑ of hep-lat
    moveUp.click();
    expect(editor.getSelected()).toEqual(["hep-lat", "hep-ph", "nucl-th"]);
  });

  it("tells the requests a first load needs, and warns above ten categories", () => {
    const { editor, click } = open();
    click("hep-ph");
    click("hep-lat");
    click("nucl-th");
    const estimate = () =>
      [
        ...editor.panel.querySelectorAll(".arxiv-browser__editor-estimate p"),
      ].map((p) => p.textContent);
    expect(estimate()).toEqual([
      msg("arxiv-browser-editor-estimate", {
        new: 3,
        newTime: msg("arxiv-browser-duration-seconds", { count: 30 }),
        recent: 16,
        // 15 intervals of 15 s: 3 min 45 s, not rounded up
        recentTime: msg("arxiv-browser-duration-minutes-seconds", {
          minutes: 3,
          seconds: 45,
        }),
        catchup: 3,
      }),
    ]);
    for (const name of [
      "hep-th",
      "hep-ex",
      "gr-qc",
      "quant-ph",
      "nucl-ex",
      "astro-ph.CO",
      "astro-ph.HE",
      "math-ph",
    ]) {
      click(name);
    }
    expect(estimate()).toHaveLength(2);
    expect(estimate()[1]).toBe(
      msg("arxiv-browser-editor-many", {
        time: msg("arxiv-browser-duration-minutes-seconds", {
          minutes: 13,
          seconds: 45,
        }),
      }),
    );
  });

  it("saves canonical names, the sections and a default name", () => {
    const { editor, onSave, onClose, click, saveButton } = open();
    expect(saveButton().disabled).toBe(true);
    click("hep-ph");
    click("math.MP");
    const sections = [
      ...editor.panel.querySelectorAll(".arxiv-browser__editor-sections input"),
    ] as HTMLInputElement[];
    expect(sections.map((input) => input.checked)).toEqual([true, true, false]);
    sections[2].click();
    saveButton().click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as ArxivSubscription;
    expect(saved).toMatchObject({
      name: "Subscription 1",
      categories: ["hep-ph", "math-ph"],
      sections: { new: true, cross: true, replace: true },
    });
    expect(saved.id).toMatch(/^sub-/);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.panel.isConnected).toBe(false);
  });

  it("cannot save without a shown section", () => {
    const { editor, click, saveButton } = open();
    click("hep-ph");
    const sections = [
      ...editor.panel.querySelectorAll(".arxiv-browser__editor-sections input"),
    ] as HTMLInputElement[];
    sections[0].click();
    sections[1].click();
    expect(saveButton().disabled).toBe(true);
  });

  it("changes a subscription under its own key", () => {
    const { editor, onSave, click, saveButton } = open({
      subscription: subscription(),
    });
    expect(editor.getSelected()).toEqual(["hep-ph", "hep-lat"]);
    click("hep-lat");
    click("nucl-th");
    saveButton().click();
    expect(onSave.mock.calls[0][0]).toEqual({
      ...subscription(),
      categories: ["hep-ph", "nucl-th"],
    });
  });

  it("closes on Escape without saving", () => {
    const { onSave, onClose, click } = open({ subscription: subscription() });
    click("hep-lat");
    win.document.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Escape" }),
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says '1 request' for a single request in both languages", () => {
    for (const [locale, words] of [
      ["en-US", "1 request"],
      ["zh-CN", "1 次请求"],
    ]) {
      const text = readFileSync(
        new URL(`../addon/locale/${locale}/addon.ftl`, import.meta.url),
        "utf8",
      );
      const message = new FluentParser()
        .parse(text)
        .body.find(
          (entry): entry is Message =>
            entry instanceof Message &&
            entry.id.name === "arxiv-browser-editor-estimate",
        )!;
      // The count of new requests ($new) selects on the exact number 1
      const select = message.value!.elements.find(
        (element): element is Placeable =>
          element instanceof Placeable &&
          element.expression instanceof SelectExpression &&
          element.expression.selector instanceof VariableReference &&
          element.expression.selector.id.name === "new",
      )!.expression as SelectExpression;
      const one = select.variants.find(
        (variant) =>
          variant.key instanceof NumberLiteral && variant.key.value === "1",
      )!;
      expect(
        one.value.elements
          .filter((element) => element instanceof TextElement)
          .map((element) => (element as TextElement).value)
          .join(""),
      ).toBe(words);
    }
  });

  it("formats durations in seconds, then minutes, never rounding up", () => {
    expect(formatDuration(30000)).toBe(
      msg("arxiv-browser-duration-seconds", { count: 30 }),
    );
    expect(formatDuration(119999)).toBe(
      msg("arxiv-browser-duration-seconds", { count: 119 }),
    );
    expect(formatDuration(240000)).toBe(
      msg("arxiv-browser-duration-minutes", { count: 4 }),
    );
    expect(formatDuration(225000)).toBe(
      msg("arxiv-browser-duration-minutes-seconds", {
        minutes: 3,
        seconds: 45,
      }),
    );
  });

  it("keeps the rest of the window out of reach while it is open", () => {
    const root = win.document.getElementById("root")!;
    const toolbar = win.document.createElement("div");
    const list = win.document.createElement("div");
    root.append(toolbar, list);
    const { editor } = open();
    expect(toolbar.hasAttribute("inert")).toBe(true);
    expect(list.hasAttribute("inert")).toBe(true);
    expect(editor.panel.closest("[inert]")).toBeNull();
    editor.close();
    expect(toolbar.hasAttribute("inert")).toBe(false);
    expect(list.hasAttribute("inert")).toBe(false);
  });
});

describe("subscription bar", () => {
  function bar(confirm = vi.fn(() => true)) {
    const onChange = vi.fn();
    const root = win.document.getElementById("root")!;
    const instance = new SubscriptionBar({ host: root, onChange, confirm });
    root.append(instance.element);
    const buttons = () =>
      Object.fromEntries(
        [...instance.element.querySelectorAll("button")].map((b) => [
          b.textContent,
          b,
        ]),
      ) as Record<string, HTMLButtonElement>;
    return { instance, onChange, confirm, buttons, root };
  }

  it("without subscriptions offers only to make one", () => {
    const { instance, buttons } = bar();
    expect(instance.current).toBeUndefined();
    expect(buttons()[msg("arxiv-browser-subscription-edit")].disabled).toBe(
      true,
    );
    expect(buttons()[msg("arxiv-browser-subscription-delete")].disabled).toBe(
      true,
    );
  });

  it("saves a new subscription, chooses it and reports it", () => {
    const { instance, onChange, buttons, root } = bar();
    buttons()[msg("arxiv-browser-subscription-new")].click();
    const editorRow = [
      ...root.querySelectorAll(".arxiv-browser__editor-row"),
    ].find((row) => row.textContent!.startsWith("hep-ph"))!;
    editorRow.querySelector("input")!.click();
    [...root.querySelectorAll(".arxiv-browser__editor button")]
      .find((b) => b.textContent === msg("arxiv-browser-editor-save"))!
      .dispatchEvent(new win.MouseEvent("click"));

    expect(stored()).toHaveLength(1);
    expect(stored()[0].categories).toEqual(["hep-ph"]);
    expect(stored()[0].name).toBe(
      msg("arxiv-browser-subscription-default-name", { number: 1 }),
    );
    expect(instance.current?.id).toBe(stored()[0].id);
    expect(onChange).toHaveBeenCalledWith(instance.current);
    const chips = instance.element.querySelectorAll(".arxiv-browser__chip");
    expect([...chips].map((chip) => chip.textContent)).toEqual(["hep-ph"]);
    expect((chips[0] as HTMLElement).title).toBe(
      "hep-ph: High Energy Physics - Phenomenology",
    );
  });

  it("switches subscriptions and deletes the chosen one after asking", () => {
    saveSubscriptions([
      subscription(),
      subscription({ id: "sub-2", name: "Math", categories: ["math"] }),
    ]);
    const confirm = vi.fn(() => false);
    const { instance, onChange, buttons } = bar(confirm);
    const select = instance.element.querySelector("select")!;
    select.value = "sub-2";
    select.dispatchEvent(new win.Event("change"));
    expect(instance.current?.name).toBe("Math");
    expect(onChange).toHaveBeenLastCalledWith(instance.current);

    onChange.mockClear();
    buttons()[msg("arxiv-browser-subscription-delete")].click();
    expect(confirm).toHaveBeenCalledWith(
      msg("arxiv-browser-subscription-delete-confirm", { name: "Math" }),
    );
    expect(stored()).toHaveLength(2);
    expect(instance.current?.name).toBe("Math");
    expect(onChange).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    buttons()[msg("arxiv-browser-subscription-delete")].click();
    expect(stored().map((item) => item.id)).toEqual(["sub-1"]);
    expect(instance.current?.id).toBe("sub-1");
    expect(onChange).toHaveBeenLastCalledWith(instance.current);
  });

  it("deletes the last subscription, leaving none chosen", () => {
    saveSubscriptions([subscription()]);
    const { instance, onChange, buttons } = bar();
    buttons()[msg("arxiv-browser-subscription-delete")].click();
    expect(stored()).toEqual([]);
    expect(instance.current).toBeUndefined();
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("names a new subscription with a number no other has", () => {
    const name = (number: number) =>
      msg("arxiv-browser-subscription-default-name", { number });
    // "Subscription 2" was deleted: two subscriptions, but 3 is taken
    saveSubscriptions([
      subscription({ id: "sub-1", name: name(1) }),
      subscription({ id: "sub-3", name: name(3) }),
    ]);
    const { instance, buttons, root } = bar();
    buttons()[msg("arxiv-browser-subscription-new")].click();
    const nameInput = root.querySelector(
      ".arxiv-browser__field input",
    ) as HTMLInputElement;
    expect(nameInput.placeholder).toBe(name(2));
    const hepPh = [...root.querySelectorAll(".arxiv-browser__editor-row")].find(
      (row) => row.textContent!.startsWith("hep-ph"),
    )!;
    hepPh.querySelector("input")!.click();
    [...root.querySelectorAll(".arxiv-browser__editor button")]
      .find((b) => b.textContent === msg("arxiv-browser-editor-save"))!
      .dispatchEvent(new win.MouseEvent("click"));
    expect(instance.current?.name).toBe(name(2));
  });

  it("keeps a changed subscription under its key and place", () => {
    saveSubscriptions([
      subscription(),
      subscription({ id: "sub-2", name: "Math", categories: ["math"] }),
    ]);
    const { instance, onChange } = bar();
    instance.updateCurrent({
      sections: { new: true, cross: false, replace: true },
    });
    expect(onChange).toHaveBeenLastCalledWith(instance.current);
    expect(instance.current?.sections.cross).toBe(false);
    expect(stored().map((item) => item.id)).toEqual(["sub-1", "sub-2"]);
    expect(stored()[0].sections).toEqual({
      new: true,
      cross: false,
      replace: true,
    });
  });
});
