// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CitationGraphDialog } from "../src/modules/inspire/panel/CitationGraphDialog";
import { AcademicTreeView } from "../src/modules/inspire/panel/AcademicTreeView";

const fixture = vi.hoisted(() => ({
  profiles: [
    {
      recid: "1",
      name: "Root Author",
      bai: "Root.Author.1",
      advisors: [{ name: "Mentor Author", recid: "2", degreeType: "phd" }],
    },
    { recid: "2", name: "Mentor Author", bai: "Mentor.Author.1", advisors: [] },
    {
      recid: "3",
      name: "Student Author",
      advisors: [{ name: "Root Author", recid: "1", degreeType: "master" }],
    },
  ],
  profile: vi.fn(),
  students: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../src/modules/inspire/academicTreeDataService", () => ({
  academicTreeSource: { profile: fixture.profile, students: fixture.students },
  searchAcademicAuthors: fixture.search,
  checkAcademicAbort: (signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  },
}));
vi.mock("../src/utils/locale", () => ({
  getString: (key: string) => key,
  getLocaleID: () => "en-US",
  initLocale: vi.fn(),
}));
vi.mock("../src/utils/prefs", () => ({ getPref: vi.fn(), setPref: vi.fn() }));

let dialog: CitationGraphDialog | undefined;
let view: AcademicTreeView | undefined;
const doc = globalThis.document;
const win = globalThis.window;
const nameElement = (id: string) =>
  doc.querySelector<SVGTextElement>(`[data-author-id="${id}"] text`)!;
const click = (el: Element) =>
  el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
const button = (label: string) =>
  [...doc.querySelectorAll("button")].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label,
  )!;
const waitLoaded = async () => {
  await vi.waitFor(() =>
    expect(button("academic-tree-stop")?.disabled).toBe(true),
  );
};
const rootIs = async (id: string) => {
  await vi.waitFor(() =>
    expect(doc.querySelector(`[data-root-author-id="${id}"]`)).toBeTruthy(),
  );
  await waitLoaded();
};
const setSelect = (label: string, value: string) => {
  const select = doc.querySelector<HTMLSelectElement>(
    `select[aria-label="${label}"]`,
  )!;
  select.value = value;
  select.dispatchEvent(new win.Event("change"));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(win.HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  fixture.profile.mockImplementation(
    async (id: string, signal: AbortSignal) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const profile = fixture.profiles.find((p) => p.recid === id);
      if (!profile) throw new Error("404");
      return profile;
    },
  );
  fixture.students.mockImplementation(async (id: string) => {
    const profiles = fixture.profiles.filter((p) =>
      p.advisors.some((a) => a.recid === id),
    );
    return { profiles, total: profiles.length, hasMore: false };
  });
  fixture.search.mockResolvedValue(fixture.profiles);
  vi.stubGlobal("Zotero", {
    debug: vi.fn(),
    getMainWindow: () => win,
    launchURL: vi.fn(),
    Prefs: { get: vi.fn() },
    getActiveZoteroPane: () => ({ getSelectedItems: () => [] }),
  });
  vi.stubGlobal("addon", { data: {} });
  vi.stubGlobal("ztoolkit", {
    getGlobal: (name: string) => (win as any)[name],
  });
  vi.spyOn(win.Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 100,
    top: 100,
    left: 100,
    right: 1100,
    bottom: 650,
    width: 1000,
    height: 550,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  dialog?.dispose();
  view?.dispose();
  dialog = undefined;
  view = undefined;
  doc.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(onViewAuthorPapers = vi.fn()) {
  dialog = new CitationGraphDialog(doc, [], {
    academicAuthor: { recid: "1", fullName: "Root Author" },
    onViewAuthorPapers,
    authorPreviewCallbacks: {
      isFavorite: () => false,
      toggleFavorite: vi.fn(),
    },
  });
  return onViewAuthorPapers;
}

describe("Academic Tree window interactions", () => {
  it("renders compact cards with centered single-line and two-line labels at the existing font size", async () => {
    vi.mocked(win.HTMLCanvasElement.prototype.getContext).mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: Array.from(text).length * 7 }),
    } as unknown as CanvasRenderingContext2D);
    fixture.profile.mockImplementation(async (id: string) => ({
      ...fixture.profiles.find((profile) => profile.recid === id),
      name: id === "1" ? "Feng-Kun Guo" : "W".repeat(30),
    }));
    open();
    await rootIs("1");
    for (const id of ["1", "2"]) {
      const rect = doc.querySelector(`[data-author-id="${id}"] rect`)!;
      expect(rect.getAttribute("width")).toBe("148");
      expect(rect.getAttribute("height")).toBe("40");
      expect(nameElement(id).getAttribute("font-size")).toBe("13");
      for (const line of nameElement(id).querySelectorAll("tspan"))
        expect(line.textContent!.length * 7).toBeLessThanOrEqual(124);
    }
    expect(nameElement("1").querySelectorAll("tspan")).toHaveLength(1);
    expect(nameElement("1").getAttribute("y")).toBe("24");
    expect(nameElement("2").querySelectorAll("tspan")).toHaveLength(2);
    expect(nameElement("2").getAttribute("y")).toBe("16");
    expect(
      nameElement("2").querySelectorAll("tspan")[1].getAttribute("dy"),
    ).toBe("16");
  });
  it("highlights the inspected relationships and preserves keyboard focus when selecting a card", async () => {
    open();
    await rootIs("1");
    const card = doc.querySelector<SVGGElement>('[data-author-id="2"]')!;
    const unrelated = doc.querySelector<SVGPathElement>(
      'path[data-source="1"][data-target="3"]',
    )!;
    const related = doc.querySelector<SVGPathElement>(
      'path[data-source="2"][data-target="1"]',
    )!;
    const text = nameElement("2");
    expect(text.style.textDecoration).toBe("none");
    card.dispatchEvent(new win.MouseEvent("mouseenter"));
    expect(Number(related.getAttribute("stroke-opacity"))).toBeGreaterThan(
      Number(unrelated.getAttribute("stroke-opacity")),
    );
    card.dispatchEvent(new win.MouseEvent("mouseleave"));
    card.focus();
    card.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(doc.activeElement).toBe(card);
    expect(nameElement("2")).toBe(text);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    text.focus();
    expect(text.style.textDecoration).toBe("underline");
    text.blur();
    expect(text.style.textDecoration).toBe("none");
    expect(doc.querySelectorAll("path[data-source]")).toHaveLength(2);
  });
  it("disables expansion at six generations and lets a boundary name become a new center", async () => {
    const profiles = Array.from({ length: 15 }, (_, i) => ({
      recid: String(i + 1),
      name: `Author ${i + 1}`,
      advisors: i
        ? [{ recid: String(i), name: `Author ${i}`, degreeType: "phd" }]
        : [],
    }));
    fixture.profile.mockImplementation(async (id: string) =>
      profiles.find((p) => p.recid === id),
    );
    fixture.students.mockImplementation(async (id: string) => {
      const students = profiles.filter((p) =>
        p.advisors.some((a) => a.recid === id),
      );
      return { profiles: students, total: students.length, hasMore: false };
    });
    view = new AcademicTreeView(
      doc,
      { recid: "8", fullName: "Author 8" },
      vi.fn(),
    );
    doc.body.append(view.element);
    await rootIs("8");
    setSelect("academic-tree-up", "6");
    setSelect("academic-tree-down", "6");
    await rootIs("8");
    expect(nameElement("1")).toBeNull();
    expect(nameElement("15")).toBeNull();
    click(doc.querySelector('[data-author-id="2"] rect')!);
    expect(button("academic-tree-expand-up").disabled).toBe(true);
    click(doc.querySelector('[data-author-id="14"] rect')!);
    expect(button("academic-tree-expand-down").disabled).toBe(true);
    expect(button("academic-tree-expand-down").title).toBe(
      "academic-tree-depth-limit",
    );
    click(nameElement("14"));
    await rootIs("14");
    expect(nameElement("15")).toBeTruthy();
  });
  it("dismisses search candidates when choosing the current author without adding a history visit", async () => {
    const sidebar = open();
    await rootIs("1");
    click(button("academic-tree-search"));
    await vi.waitFor(() =>
      expect(button("Root Author — Root.Author.1")).toBeTruthy(),
    );
    click(button("Root Author — Root.Author.1"));
    await vi.waitFor(() =>
      expect(sidebar).toHaveBeenCalledWith(
        expect.objectContaining({ recid: "1" }),
      ),
    );
    expect(button("Root Author — Root.Author.1")).toBeUndefined();
    expect(button("academic-tree-back").disabled).toBe(true);
    expect(button("academic-tree-forward").disabled).toBe(true);
    expect(doc.querySelector('[role="status"]')!.textContent).toBe(
      "academic-tree-count",
    );
  });
  it("keeps history empty when the current author is clicked again", async () => {
    const sidebar = open();
    await rootIs("1");
    click(nameElement("1"));
    await vi.waitFor(() => expect(sidebar).toHaveBeenCalled());
    expect(button("academic-tree-back").disabled).toBe(true);
    expect(button("academic-tree-forward").disabled).toBe(true);
  });
  it("restores expanded branches, selection, filters, viewport and sidebar on back/forward", async () => {
    const sidebar = open();
    await rootIs("1");
    setSelect("academic-tree-up", "0");
    setSelect("academic-tree-down", "0");
    setSelect("academic-tree-degree", "phd");
    await rootIs("1");
    click(button("academic-tree-expand-up"));
    await vi.waitFor(() => expect(nameElement("2")).toBeTruthy());
    await waitLoaded();
    click(doc.querySelector('[data-author-id="2"] rect')!);
    click(button("academic-tree-zoom-in"));
    const transform = doc
      .querySelector(".zinspire-academic-tree svg > g")!
      .getAttribute("transform");
    click(nameElement("2"));
    await rootIs("2");
    setSelect("academic-tree-down", "2");
    await rootIs("2");
    const callsBeforeBack = fixture.students.mock.calls.length;
    click(button("academic-tree-back"));
    await rootIs("1");
    expect(fixture.students.mock.calls.length).toBe(callsBeforeBack);
    expect(
      doc.querySelector<HTMLSelectElement>('[aria-label="academic-tree-down"]')!
        .value,
    ).toBe("0");
    expect(
      doc.querySelector<HTMLSelectElement>('[aria-label="academic-tree-up"]')!
        .value,
    ).toBe("0");
    expect(
      doc.querySelector<HTMLSelectElement>(
        '[aria-label="academic-tree-degree"]',
      )!.value,
    ).toBe("phd");
    expect(nameElement("2")).toBeTruthy();
    expect(
      doc
        .querySelector('[data-author-id="2"] rect')!
        .parentElement?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      doc
        .querySelector(".zinspire-academic-tree svg > g")!
        .getAttribute("transform"),
    ).toBe(transform);
    expect(sidebar).toHaveBeenLastCalledWith(
      expect.objectContaining({ recid: "1" }),
    );
    expect(button("academic-tree-back").disabled).toBe(true);
    expect(button("academic-tree-forward").disabled).toBe(false);
    click(button("academic-tree-forward"));
    await rootIs("2");
    expect(
      doc.querySelector<HTMLSelectElement>('[aria-label="academic-tree-down"]')!
        .value,
    ).toBe("2");
    expect(sidebar).toHaveBeenLastCalledWith(
      expect.objectContaining({ recid: "2" }),
    );
    expect(button("academic-tree-forward").disabled).toBe(true);
    expect(doc.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it("clears forward visits when a different author is chosen after going back", async () => {
    open();
    await rootIs("1");
    click(nameElement("2"));
    await rootIs("2");
    click(button("academic-tree-back"));
    await rootIs("1");
    click(nameElement("1"));
    expect(button("academic-tree-forward").disabled).toBe(false);
    click(nameElement("3"));
    await rootIs("3");
    expect(button("academic-tree-forward").disabled).toBe(true);
    click(button("academic-tree-back"));
    await rootIs("1");
    click(button("academic-tree-forward"));
    await rootIs("3");
  });
  it("aborts a pending visit on back and ignores late tree/sidebar responses; forward retries it", async () => {
    const sidebar = open();
    await rootIs("1");
    const pending: Array<{
      signal: AbortSignal;
      resolve: (value: (typeof fixture.profiles)[number]) => void;
    }> = [];
    const original = fixture.profile.getMockImplementation()!;
    fixture.profile.mockImplementation((id: string, signal: AbortSignal) =>
      id === "2"
        ? new Promise((resolve) => pending.push({ signal, resolve }))
        : original(id, signal),
    );
    click(nameElement("2"));
    expect(doc.querySelector("[data-root-author-id]")).toBeNull();
    expect(button("academic-tree-back").disabled).toBe(false);
    click(button("academic-tree-back"));
    await rootIs("1");
    expect(pending.length).toBeGreaterThan(0);
    for (const request of pending) {
      expect(request.signal.aborted).toBe(true);
      request.resolve(fixture.profiles[1]);
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(sidebar).toHaveBeenLastCalledWith(
      expect.objectContaining({ recid: "1" }),
    );
    expect(doc.querySelector('[data-root-author-id="2"]')).toBeNull();
    fixture.profile.mockImplementation(original);
    click(button("academic-tree-forward"));
    await rootIs("2");
    expect(sidebar).toHaveBeenLastCalledWith(
      expect.objectContaining({ recid: "2" }),
    );
  });
  it("retains at most twenty back visits", async () => {
    open();
    await rootIs("1");
    for (let i = 0; i < 22; i++) {
      const id = i % 2 === 0 ? "2" : "1";
      click(nameElement(id));
      await rootIs(id);
    }
    for (let i = 0; i < 20; i++) {
      expect(button("academic-tree-back").disabled).toBe(false);
      click(button("academic-tree-back"));
    }
    expect(button("academic-tree-back").disabled).toBe(true);
    expect(button("academic-tree-forward").disabled).toBe(false);
  });
  it("shares citation graph chrome, defaults both controls to two, and offers 0–6", async () => {
    open();
    await vi.waitFor(() => expect(nameElement("2")).toBeTruthy());
    await waitLoaded();
    expect(doc.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    for (const label of ["academic-tree-up", "academic-tree-down"]) {
      const select = doc.querySelector<HTMLSelectElement>(
        `select[aria-label="${label}"]`,
      )!;
      expect(select.value).toBe("2");
      expect([...select.options].map((o) => o.value)).toEqual(
        Array.from({ length: 7 }, (_, i) => String(i)),
      );
    }
    click(button("references-panel-citation-graph-title"));
    expect(
      (doc.querySelector(".zinspire-academic-tree") as HTMLElement).style
        .display,
    ).toBe("none");
    click(button("academic-tree-title"));
    expect(
      (doc.querySelector(".zinspire-academic-tree") as HTMLElement).style
        .display,
    ).toBe("flex");
  });
  it("clicking a name re-roots the tree and opens the sidebar author without closing the window", async () => {
    const sidebar = open();
    await vi.waitFor(() => expect(nameElement("2")).toBeTruthy());
    await waitLoaded();
    click(nameElement("2"));
    await vi.waitFor(() =>
      expect(sidebar).toHaveBeenCalledWith({
        recid: "2",
        bai: "Mentor.Author.1",
        fullName: "Mentor Author",
      }),
    );
    await vi.waitFor(() =>
      expect(doc.querySelector('[data-root-author-id="2"]')).toBeTruthy(),
    );
    expect(doc.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it("hovering a name uses the existing author preview card with its normal actions", async () => {
    open();
    await vi.waitFor(() => expect(nameElement("2")).toBeTruthy());
    await waitLoaded();
    nameElement("2").dispatchEvent(new win.MouseEvent("mouseenter"));
    await vi.waitFor(() => {
      const card = doc.querySelector<HTMLElement>(
        ".zinspire-author-preview-card",
      );
      expect(card?.style.display).toBe("block");
      expect(card?.textContent).toContain("Mentor Author");
      expect(card?.textContent).toContain(
        "references-panel-author-preview-view-papers",
      );
      expect(card?.textContent).toContain("☆");
    });
    dialog!.dispose();
    dialog = undefined;
    expect(doc.querySelector(".zinspire-author-preview-card")).toBeNull();
  });
  it("selecting a card preserves the root and offers local expansion actions", async () => {
    open();
    await vi.waitFor(() => expect(nameElement("2")).toBeTruthy());
    await waitLoaded();
    click(doc.querySelector('[data-author-id="2"] rect')!);
    expect(doc.querySelector('[data-root-author-id="1"]')).toBeTruthy();
    expect(button("academic-tree-expand-up")).toBeTruthy();
    expect(button("academic-tree-expand-down")).toBeTruthy();
  });
  it("zero generations hides both directions", async () => {
    open();
    await vi.waitFor(() => expect(nameElement("2")).toBeTruthy());
    await waitLoaded();
    for (const label of ["academic-tree-up", "academic-tree-down"]) {
      const select = doc.querySelector<HTMLSelectElement>(
        `select[aria-label="${label}"]`,
      )!;
      select.value = "0";
      select.dispatchEvent(new win.Event("change"));
    }
    await vi.waitFor(() =>
      expect(doc.querySelectorAll("[data-author-id]")).toHaveLength(1),
    );
    expect(doc.querySelector('[data-root-author-id="1"]')).toBeTruthy();
  });
  it("does not accept stale author-search results after selecting a new root", async () => {
    open();
    await vi.waitFor(() => expect(nameElement("2")).toBeTruthy());
    await waitLoaded();
    let finish!: (value: typeof fixture.profiles) => void;
    fixture.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    click(button("academic-tree-search"));
    click(nameElement("2"));
    finish(fixture.profiles);
    await vi.waitFor(() =>
      expect(doc.querySelector('[data-root-author-id="2"]')).toBeTruthy(),
    );
    expect(doc.body.textContent).not.toContain("Root Author — Root.Author.1");
  });
  it("closing while a root request is pending cancels it and prevents late DOM updates", async () => {
    let finish!: () => void;
    fixture.profile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(fixture.profiles[0]);
        }),
    );
    open();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const signal = fixture.profile.mock.calls[0][1] as AbortSignal;
    dialog!.dispose();
    dialog = undefined;
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(doc.querySelector('[role="dialog"]')).toBeNull();
  });
});
