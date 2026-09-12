import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("../src/modules/inspire/rateLimiter", () => ({
  inspireFetch: mocks.fetch,
}));
vi.mock("../src/modules/inspire/localCache", () => ({
  localCache: { get: mocks.get, set: mocks.set },
}));
const signal = () => new AbortController().signal;
const row = (id: string) => ({
  id,
  metadata: { name: { value: `Author ${id}` }, advisors: [] },
});
const response = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue(undefined);
});
describe("academic tree data source", () => {
  it("shares one exact-author request between sidebar and tree and preserves shared profile data", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    const { fetchAuthorProfile } =
      await import("../src/modules/inspire/authorProfileService");
    let complete!: (value: unknown) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const sidebar = fetchAuthorProfile({ recid: "20", fullName: "Display" });
    const tree = academicTreeSource.profile("20", signal());
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    complete(
      response({
        id: "20",
        metadata: {
          name: { value: "Surname, Given", preferred_name: "Given Surname" },
          positions: [{ institution: "Past", rank: "PHD", end_date: "2007" }],
        },
      }),
    );
    const [a, b] = await Promise.all([sidebar, tree]);
    expect(a?.currentPosition?.institution).toBe("Past");
    expect(b.currentPosition).toBeUndefined();
    expect(b.canonicalName).toBe("Surname, Given");
    expect(b.positions?.[0].endDate).toBe("2007");
    expect(
      (await fetchAuthorProfile({ recid: "20", fullName: "" }))?.currentPosition
        ?.institution,
    ).toBe("Past");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("a stopped tree does not cancel a simultaneous sidebar profile", async () => {
    const { fetchAuthorRecord } =
      await import("../src/modules/inspire/authorProfileRecords");
    let complete!: (value: unknown) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const stop = new AbortController();
    const a = fetchAuthorRecord("21", stop.signal);
    const b = fetchAuthorRecord("21", signal());
    const stopped = expect(a).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    stop.abort();
    await stopped;
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    complete(response(row("21")));
    expect((await b).recid).toBe("21");
  });
  it("upgrades old cached profiles once and serves subsequent sidebar and tree visits", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    const { fetchAuthorProfile } =
      await import("../src/modules/inspire/authorProfileService");
    mocks.get.mockResolvedValue({
      data: { profile: { recid: "22", name: "Legacy" }, fetchedAt: Date.now() },
    });
    mocks.fetch.mockResolvedValue(response(row("22")));
    expect(
      (await fetchAuthorProfile({ recid: "22", fullName: "" }))?.profileVersion,
    ).toBe(2);
    await academicTreeSource.profile("22", signal());
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("a slow old request cannot overwrite a forced refresh", async () => {
    const { fetchAuthorRecord } =
      await import("../src/modules/inspire/authorProfileRecords");
    let oldComplete!: (value: unknown) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldComplete = resolve;
        }),
    );
    const old = fetchAuthorRecord("23", signal());
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    mocks.fetch.mockResolvedValueOnce(
      response({ id: "23", metadata: { name: { value: "Fresh" } } }),
    );
    expect((await fetchAuthorRecord("23", signal(), true)).name).toBe("Fresh");
    oldComplete(response({ id: "23", metadata: { name: { value: "Old" } } }));
    await old;
    expect((await fetchAuthorRecord("23", signal())).name).toBe("Fresh");
    expect(mocks.set).toHaveBeenCalledTimes(1);
  });
  it("full student search records seed the sidebar cache without another request", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    const { fetchAuthorProfile } =
      await import("../src/modules/inspire/authorProfileService");
    mocks.fetch.mockResolvedValue(
      response({ hits: { hits: [row("24")], total: 1 } }),
    );
    await academicTreeSource.students("1", 1, signal());
    expect(
      (await fetchAuthorProfile({ recid: "24", fullName: "" }))?.name,
    ).toBe("Author 24");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it("uses the limited fetch wrapper, fresh disk cache and then memory cache", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.get.mockResolvedValue({
      data: {
        profile: {
          recid: "1",
          name: "Cached",
          advisors: [],
          profileVersion: 2,
          positions: [],
        },
        fetchedAt: Date.now(),
      },
    });
    expect((await academicTreeSource.profile("1", signal())).name).toBe(
      "Cached",
    );
    await academicTreeSource.profile("1", signal());
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("refetches expired disk data rather than renewing its timestamp", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.get.mockResolvedValue({
      data: {
        profile: { recid: "2", name: "Old", profileVersion: 2, positions: [] },
        fetchedAt: Date.now() - 3 * 3600000,
      },
    });
    mocks.fetch.mockResolvedValue(response(row("2")));
    expect((await academicTreeSource.profile("2", signal())).name).toBe(
      "Author 2",
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://inspirehep.net/api/authors/2",
      { signal: expect.anything() },
    );
    expect(mocks.set).toHaveBeenCalledWith(
      "author_profile",
      "v2:2",
      expect.anything(),
    );
  });
  it("keeps HTTP and malformed-record failures retryable", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.fetch
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce(response({ hits: {} }))
      .mockResolvedValueOnce(response(row("3")));
    await expect(academicTreeSource.profile("3", signal())).rejects.toThrow(
      "502",
    );
    await expect(academicTreeSource.profile("3", signal())).rejects.toThrow(
      "Invalid author",
    );
    expect(mocks.set).not.toHaveBeenCalled();
    expect((await academicTreeSource.profile("3", signal())).recid).toBe("3");
  });
  it("encodes the documented students query, pages it and rejects incomplete pages", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.fetch
      .mockResolvedValueOnce(
        response({
          hits: {
            hits: Array.from({ length: 50 }, (_, i) => row(String(50 + i))),
            total: 51,
          },
        }),
      )
      .mockResolvedValueOnce(response({ hits: { hits: [], total: 51 } }));
    expect((await academicTreeSource.students("4", 1, signal())).hasMore).toBe(
      true,
    );
    const url = new URL(mocks.fetch.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toBe("advisors.record.$ref:4");
    expect(url.searchParams.get("size")).toBe("50");
    await expect(academicTreeSource.students("4", 2, signal())).rejects.toThrow(
      "Incomplete",
    );
  });
  it("does not resolve an ambiguous name or expose hidden advisors", async () => {
    const { searchAcademicAuthors } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.fetch.mockResolvedValue(
      response({
        hits: {
          total: 2,
          hits: [
            {
              id: "6",
              metadata: {
                name: { value: "Same" },
                advisors: [
                  { name: "Private", hidden: true },
                  { name: "Public", degree_type: "other" },
                ],
              },
            },
            { id: "7", metadata: { name: { value: "Same" } } },
          ],
        },
      }),
    );
    const results = await searchAcademicAuthors("Same", signal());
    expect(results.map((p) => p.recid)).toEqual(["6", "7"]);
    expect(results[0].advisors).toEqual([
      { name: "Public", degreeType: "other", recid: undefined },
    ]);
  });
  it("forced refresh bypasses memory and disk, updates caches, and resumes successful requests without refetching", async () => {
    const { academicTreeSource, createAcademicTreeSession } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.get.mockResolvedValue({
      data: {
        profile: { recid: "1", name: "Old", profileVersion: 2, positions: [] },
        fetchedAt: Date.now(),
      },
    });
    expect((await academicTreeSource.profile("1", signal())).name).toBe("Old");
    mocks.get.mockClear();
    mocks.fetch
      .mockResolvedValueOnce(response(row("1")))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response({ hits: { hits: [], total: 0 } }));
    const session = createAcademicTreeSession(true);
    expect((await session.profile("1", signal())).name).toBe("Author 1");
    await expect(session.students("1", 1, signal())).rejects.toThrow("503");
    await session.profile("1", signal());
    await session.students("1", 1, signal());
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(
      mocks.fetch.mock.calls.every(
        ([, options]) => options.cache === "no-store",
      ),
    ).toBe(true);
    expect((await academicTreeSource.profile("1", signal())).name).toBe(
      "Author 1",
    );
    expect(mocks.set).toHaveBeenCalledTimes(2);
    const nextRefresh = createAcademicTreeSession(true);
    mocks.fetch.mockResolvedValueOnce(response(row("1")));
    await nextRefresh.profile("1", signal());
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
  });
  it("never labels historical positions current and retains multiple explicitly current affiliations", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.fetch.mockResolvedValueOnce(
      response({
        ...row("10"),
        metadata: {
          name: { value: "Former" },
          positions: [{ institution: "Former Institute", current: false }],
        },
      }),
    );
    expect(
      (await academicTreeSource.profile("10", signal())).currentPosition,
    ).toBeUndefined();
    mocks.fetch.mockResolvedValueOnce(
      response({
        ...row("11"),
        metadata: {
          name: { value: "Current" },
          positions: [
            { institution: "Old" },
            { institution: "Institute A", current: true },
            { institution: "Institute B", current: true },
          ],
        },
      }),
    );
    expect(
      (await academicTreeSource.profile("11", signal())).currentPosition
        ?.institution,
    ).toBe("Institute A; Institute B");
  });
  it("rejects cancellation before cache access and after a late response", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    const controller = new AbortController();
    controller.abort();
    await expect(
      academicTreeSource.profile("8", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.get).not.toHaveBeenCalled();
    const later = new AbortController();
    mocks.fetch.mockImplementation(async () => {
      later.abort();
      return response(row("9"));
    });
    await expect(
      academicTreeSource.profile("9", later.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
