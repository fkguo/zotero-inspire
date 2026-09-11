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
  it("uses the limited fetch wrapper, fresh disk cache and then memory cache", async () => {
    const { academicTreeSource } =
      await import("../src/modules/inspire/academicTreeDataService");
    mocks.get.mockResolvedValue({
      data: {
        data: { recid: "1", name: "Cached", advisors: [] },
        at: Date.now(),
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
      data: { data: { recid: "2", name: "Old" }, at: Date.now() - 3 * 3600000 },
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
      "academic_tree",
      "v2-profile-2",
      expect.anything(),
      undefined,
      1,
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
      data: { data: { recid: "1", name: "Old" }, at: Date.now() },
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
