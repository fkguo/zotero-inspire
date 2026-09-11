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
  session: vi.fn(),
}));
vi.mock("../src/modules/inspire/academicTreeDataService", () => ({
  academicTreeSource: { profile: fixture.profile, students: fixture.students },
  createAcademicTreeSession: fixture.session,
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
  vi.resetAllMocks();
  fixture.session.mockImplementation(() => {
    const done = new Map<string, unknown>();
    const get = async (
      key: string,
      signal: AbortSignal,
      fn: () => Promise<unknown>,
    ) => {
      if (done.has(key)) return done.get(key);
      const value = await fn();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      done.set(key, value);
      return value;
    };
    return {
      profile: (id: string, signal: AbortSignal) =>
        get(`p:${id}`, signal, () => fixture.profile(id, signal)),
      students: (id: string, page: number, signal: AbortSignal) =>
        get(`s:${id}:${page}`, signal, () =>
          fixture.students(id, page, signal),
        ),
    };
  });
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
  it("restores collapsed branches and local view settings on history navigation", async () => {
    open();
    await rootIs("1");
    click(button("academic-tree-collapse"));
    expect(doc.querySelector('[data-author-id="3"]')).toBeNull();
    expect(doc.querySelector('[data-author-id="2"]')).not.toBeNull();
    const co = doc.querySelector<HTMLInputElement>(
      '[aria-label="academic-tree-co-advisors"]',
    )!;
    co.checked = false;
    co.dispatchEvent(new win.Event("change"));
    click(nameElement("2"));
    await rootIs("2");
    click(button("academic-tree-back"));
    await rootIs("1");
    expect(co.checked).toBe(false);
    expect(doc.querySelector('[data-author-id="3"]')).toBeNull();
    const requests =
      fixture.profile.mock.calls.length + fixture.students.mock.calls.length;
    click(button("academic-tree-restore-branches"));
    expect(doc.querySelector('[data-author-id="3"]')).not.toBeNull();
    expect(
      fixture.profile.mock.calls.length + fixture.students.mock.calls.length,
    ).toBe(requests);
  });
  it("locates a hidden person without reroot, network requests or sidebar navigation", async () => {
    const sidebar = open();
    await rootIs("1");
    click(button("academic-tree-collapse"));
    const requests =
      fixture.profile.mock.calls.length + fixture.students.mock.calls.length;
    const sidebarCalls = sidebar.mock.calls.length;
    const input = doc.querySelector<HTMLInputElement>(
      '[aria-label="academic-tree-find-placeholder"]',
    )!;
    input.value = "Student";
    input.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    click(doc.querySelector("[data-academic-locate]")!);
    expect(
      doc.querySelector('[data-author-id="3"][aria-pressed="true"]'),
    ).not.toBeNull();
    expect(doc.querySelector('[data-root-author-id="1"]')).not.toBeNull();
    expect(
      fixture.profile.mock.calls.length + fixture.students.mock.calls.length,
    ).toBe(requests);
    expect(sidebar).toHaveBeenCalledTimes(sidebarCalls);
    expect(button("academic-tree-back").disabled).toBe(true);
  });
  it("highlights the relationship path and preserves its original direction", async () => {
    open();
    await rootIs("1");
    setSelect("academic-tree-path-from", "3");
    setSelect("academic-tree-path-to", "2");
    click(button("academic-tree-show-path"));
    expect(doc.body.textContent).toContain(
      "Student Author ← Root Author ← Mentor Author",
    );
    expect(
      doc
        .querySelector('path[data-source="1"][data-target="3"]')
        ?.getAttribute("stroke-width"),
    ).toBe("1.6");
    expect(
      doc
        .querySelector('path[data-source="2"][data-target="1"]')
        ?.getAttribute("stroke-width"),
    ).toBe("1.6");
    expect(doc.querySelector('[data-root-author-id="1"]')).not.toBeNull();
    click(button("academic-tree-clear-path"));
    expect(doc.body.textContent).not.toContain(
      "Student Author ← Root Author ← Mentor Author",
    );
  });
  it("expands the visible ancestors' students by one generation and refreshes the added branches", async () => {
    const cousin = {
      recid: "4",
      name: "Peer Author",
      advisors: [{ recid: "2", name: "Mentor Author", degreeType: "phd" }],
    };
    const grandchild = {
      recid: "5",
      name: "Peer Student",
      advisors: [{ recid: "4", name: "Peer Author", degreeType: "phd" }],
    };
    const original = fixture.profile.getMockImplementation()!;
    fixture.profile.mockImplementation(async (id, signal) =>
      id === "4" ? cousin : id === "5" ? grandchild : original(id, signal),
    );
    fixture.students.mockImplementation(async (id) => {
      const profiles = [...fixture.profiles, cousin, grandchild].filter((p) =>
        p.advisors.some((a) => a.recid === id),
      );
      return { profiles, total: profiles.length, hasMore: false };
    });
    open();
    await rootIs("1");
    expect(doc.querySelector('[data-author-id="4"]')).toBeNull();
    click(button("academic-tree-expand-ancestors"));
    await waitLoaded();
    expect(doc.querySelector('[data-author-id="4"]')).not.toBeNull();
    expect(doc.querySelector('[data-author-id="5"]')).toBeNull();
    const co = doc.querySelector<HTMLInputElement>(
      '[aria-label="academic-tree-co-advisors"]',
    )!;
    co.checked = false;
    co.dispatchEvent(new win.Event("change"));
    expect(doc.querySelector('[data-author-id="4"]')).not.toBeNull();
    click(button("academic-tree-refresh"));
    await waitLoaded();
    expect(doc.querySelector('[data-author-id="4"]')).not.toBeNull();
    expect(doc.querySelector('[data-author-id="5"]')).toBeNull();
  });
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
      expect(rect.getAttribute("height")).toBe("54");
      expect(nameElement(id).getAttribute("font-size")).toBe("13");
      for (const line of nameElement(id).querySelectorAll("tspan"))
        expect(line.textContent!.length * 7).toBeLessThanOrEqual(124);
    }
    expect(nameElement("1").querySelectorAll("tspan")).toHaveLength(1);
    expect(nameElement("1").getAttribute("y")).toBe("31");
    expect(nameElement("2").querySelectorAll("tspan")).toHaveLength(2);
    expect(nameElement("2").getAttribute("y")).toBe("23");
    expect(
      nameElement("2").querySelectorAll("tspan")[1].getAttribute("dy"),
    ).toBe("16");
  });
  it("shows current affiliations below names, truncating long labels with a full tooltip", async () => {
    const institution =
      "Institute of Theoretical Physics and Advanced Research ".repeat(3);
    fixture.profile.mockImplementation(async (id: string) => ({
      ...fixture.profiles.find((p) => p.recid === id),
      currentPosition: id === "2" ? { institution } : undefined,
    }));
    open();
    await rootIs("1");
    const label = doc.querySelector('[data-author-id="2"] [data-affiliation]')!;
    expect(label.getAttribute("data-affiliation")).toBe(institution);
    expect(label.firstChild?.textContent).toMatch(/…$/);
    expect(label.querySelector("title")?.textContent).toBe(institution);
    expect(label.getAttribute("y")).toBe("44");
    expect(Number(nameElement("2").getAttribute("y"))).toBeLessThan(44);
    expect(
      doc.querySelector('[data-author-id="1"] [data-affiliation]'),
    ).toBeNull();
  });
  it("refreshes without clearing the old tree and preserves the viewport on success", async () => {
    open();
    await rootIs("1");
    expect(button("academic-tree-retry").hidden).toBe(true);
    expect(button("academic-tree-stop").hidden).toBe(true);
    const canvas = doc.querySelector('[data-root-author-id="1"]')!;
    canvas.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "+", bubbles: true }),
    );
    const transform = canvas.querySelector("g")!.getAttribute("transform");
    let finish!: (value: unknown) => void;
    fixture.profile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    click(button("academic-tree-refresh"));
    expect(fixture.session).toHaveBeenLastCalledWith(true);
    expect(nameElement("1").getAttribute("aria-label")).toBe("Root Author");
    expect(button("academic-tree-stop").hidden).toBe(false);
    expect(button("academic-tree-refresh").disabled).toBe(true);
    finish({ ...fixture.profiles[0], name: "Updated Author", advisors: [] });
    await waitLoaded();
    expect(nameElement("1").getAttribute("aria-label")).toBe("Updated Author");
    expect(
      doc.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("Updated Author");
    expect(nameElement("2")).toBeNull();
    expect(canvas.querySelector("g")!.getAttribute("transform")).toBe(
      transform,
    );
  });
  it("retains the old tree after a partial refresh failure and retries only failed requests", async () => {
    open();
    await rootIs("1");
    fixture.profile.mockClear();
    fixture.students.mockClear();
    const students = fixture.students.getMockImplementation()!;
    fixture.students.mockImplementation(
      async (id: string, ...args: unknown[]) => {
        if (id === "1") throw new Error("503");
        return students(id, ...args);
      },
    );
    click(button("academic-tree-refresh"));
    await waitLoaded();
    expect(nameElement("3")).toBeTruthy();
    expect(button("academic-tree-retry").hidden).toBe(false);
    expect(doc.querySelector('[role="status"]')?.textContent).toBe(
      "academic-tree-refresh-error",
    );
    const profilesBefore = fixture.profile.mock.calls.length;
    fixture.students.mockImplementation(students);
    click(button("academic-tree-retry"));
    await waitLoaded();
    expect(fixture.profile).toHaveBeenCalledTimes(profilesBefore);
    expect(button("academic-tree-retry").hidden).toBe(true);
    expect(nameElement("3")).toBeTruthy();
  });
  it("retries an earlier failed branch after expanding a different person", async () => {
    const original = fixture.profile.getMockImplementation()!;
    fixture.profile.mockImplementation(
      async (id: string, signal: AbortSignal) => {
        if (id === "2") throw new Error("503");
        return original(id, signal);
      },
    );
    open();
    await rootIs("1");
    expect(button("academic-tree-retry").hidden).toBe(false);
    click(doc.querySelector('[data-author-id="3"] rect')!);
    click(button("academic-tree-expand-down"));
    await waitLoaded();
    expect(button("academic-tree-retry").hidden).toBe(false);
    const studentCalls = fixture.students.mock.calls.length;
    fixture.profile.mockClear();
    fixture.profile.mockImplementation(
      async (id: string, signal: AbortSignal) => {
        if (id === "2")
          return {
            ...fixture.profiles[1],
            advisors: [{ recid: "4", name: "Older Mentor", degreeType: "phd" }],
          };
        if (id === "4")
          return { recid: "4", name: "Older Mentor", advisors: [] };
        return original(id, signal);
      },
    );
    click(button("academic-tree-retry"));
    await waitLoaded();
    expect(fixture.profile.mock.calls.some(([id]) => id === "2")).toBe(true);
    expect(fixture.students).toHaveBeenCalledTimes(studentCalls);
    expect(nameElement("4")).toBeTruthy();
    expect(button("academic-tree-retry").hidden).toBe(true);
  });
  it("continues a stopped expansion at its original anchor and restores recovery controls on Back", async () => {
    open();
    await rootIs("1");
    click(doc.querySelector('[data-author-id="3"] rect')!);
    fixture.students.mockClear();
    let late!: (value: unknown) => void;
    fixture.students.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          late = resolve;
        }),
    );
    click(button("academic-tree-expand-down"));
    await vi.waitFor(() =>
      expect(fixture.students.mock.calls.at(-1)?.[0]).toBe("3"),
    );
    click(button("academic-tree-stop"));
    expect(button("academic-tree-continue").hidden).toBe(false);
    late({ profiles: [], total: 0, hasMore: false });
    click(nameElement("2"));
    await rootIs("2");
    click(button("academic-tree-back"));
    await rootIs("1");
    expect(button("academic-tree-continue").hidden).toBe(false);
    fixture.students.mockClear();
    click(button("academic-tree-continue"));
    await waitLoaded();
    expect(fixture.students).toHaveBeenCalledTimes(1);
    expect(fixture.students.mock.calls[0][0]).toBe("3");
    expect(button("academic-tree-continue")).toBeUndefined();
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
  it("disables expansion at eight generations and lets a boundary name become a new center", async () => {
    const profiles = Array.from({ length: 19 }, (_, i) => ({
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
      { recid: "10", fullName: "Author 10" },
      vi.fn(),
    );
    doc.body.append(view.element);
    await rootIs("10");
    setSelect("academic-tree-up", "8");
    setSelect("academic-tree-down", "8");
    await rootIs("10");
    expect(nameElement("1")).toBeNull();
    expect(nameElement("19")).toBeNull();
    click(doc.querySelector('[data-author-id="2"] rect')!);
    expect(button("academic-tree-expand-up").disabled).toBe(true);
    click(doc.querySelector('[data-author-id="18"] rect')!);
    expect(button("academic-tree-expand-down").disabled).toBe(true);
    expect(button("academic-tree-expand-down").title).toBe(
      "academic-tree-depth-limit",
    );
    click(nameElement("18"));
    await rootIs("18");
    expect(nameElement("19")).toBeTruthy();
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
  it("Set as center recenters the current root without reloading and switches a different selected author", async () => {
    const sidebar = open();
    await rootIs("1");
    const canvas = doc.querySelector(".zinspire-academic-tree svg")!;
    const transform = () =>
      canvas.querySelector("g")!.getAttribute("transform");
    canvas.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "+", bubbles: true }),
    );
    const centered = transform();
    canvas.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(transform()).not.toBe(centered);
    const requests = fixture.profile.mock.calls.length;
    const sidebarCalls = sidebar.mock.calls.length;
    click(button("academic-tree-reroot"));
    expect(transform()).toBe(centered);
    expect(fixture.profile).toHaveBeenCalledTimes(requests);
    expect(sidebar).toHaveBeenCalledTimes(sidebarCalls);
    expect(button("academic-tree-back").disabled).toBe(true);
    click(doc.querySelector('[data-author-id="2"] rect')!);
    click(button("academic-tree-reroot"));
    await rootIs("2");
    expect(sidebar).toHaveBeenCalledWith(
      expect.objectContaining({ recid: "2" }),
    );
    expect(button("academic-tree-back").disabled).toBe(false);
    const newCenter = transform();
    canvas.dispatchEvent(
      new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    const callsAfterReroot = sidebar.mock.calls.length;
    click(button("academic-tree-reroot"));
    expect(transform()).toBe(newCenter);
    expect(sidebar).toHaveBeenCalledTimes(callsAfterReroot);
    click(doc.querySelector('[data-author-id="1"] rect')!);
    click(button("academic-tree-reroot"));
    await rootIs("1");
    expect(sidebar).toHaveBeenLastCalledWith(
      expect.objectContaining({ recid: "1" }),
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
  it("shares citation graph chrome, defaults both controls to two, and offers 0–8", async () => {
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
        Array.from({ length: 9 }, (_, i) => String(i)),
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
