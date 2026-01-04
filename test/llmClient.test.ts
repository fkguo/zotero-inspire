import { describe, expect, it, vi } from "vitest";
import { normalizeOpenAICompatibleEndpoint, openaiCompatibleComplete, openaiCompatibleStream } from "../src/modules/inspire/llm/providers/openaiCompatible";
import type { AIProfile } from "../src/modules/inspire/llm/profileStore";
import { LLMError } from "../src/modules/inspire/llm/types";

const dummyProfile: AIProfile = {
  id: "p1",
  name: "Test",
  provider: "openaiCompatible",
  baseURL: "https://api.example.com/v1",
  model: "test-model",
  createdAt: Date.now(),
};

describe("openaiCompatible endpoint normalization", () => {
  it("appends /chat/completions when given baseURL", () => {
    expect(normalizeOpenAICompatibleEndpoint("https://x.y/v1")).toBe(
      "https://x.y/v1/chat/completions",
    );
  });

  it("keeps full endpoint when provided", () => {
    expect(
      normalizeOpenAICompatibleEndpoint("https://x.y/v1/chat/completions"),
    ).toBe("https://x.y/v1/chat/completions");
  });
});

describe("openaiCompatibleComplete", () => {
  it("extracts text and usage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await openaiCompatibleComplete({
      profile: dummyProfile,
      apiKey: "sk-test",
      user: "hi",
      system: "sys",
      temperature: 0,
      maxOutputTokens: 10,
    });

    expect(res.text).toBe("hello");
    expect(res.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
    fetchMock.mockRestore();
  });

  it("throws typed error for 401", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      openaiCompatibleComplete({
        profile: dummyProfile,
        apiKey: "sk-bad",
        user: "hi",
      }),
    ).rejects.toMatchObject<Partial<LLMError>>({
      name: "LLMError",
      code: "unauthorized",
      status: 401,
    });

    fetchMock.mockRestore();
  });
});

describe("openaiCompatibleStream", () => {
  it("streams delta content and returns full text", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      "data: [DONE]\n",
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(new TextEncoder().encode(c));
        }
        controller.close();
      },
    });

    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(stream, { status: 200 }),
    );

    const deltas: string[] = [];
    const res = await openaiCompatibleStream({
      profile: dummyProfile,
      apiKey: "sk-test",
      user: "hi",
      onDelta: (d) => deltas.push(d),
      maxOutputTokens: 10,
    });

    expect(deltas.join("")).toBe("Hello");
    expect(res.text).toBe("Hello");
    fetchMock.mockRestore();
  });
});

