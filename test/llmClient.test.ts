import { describe, expect, it, vi } from "vitest";
import {
  normalizeOpenAICompatibleEndpoint,
  openaiCompatibleComplete,
  openaiCompatibleStream,
} from "../src/modules/inspire/llm/providers/openaiCompatible";
import { geminiStream } from "../src/modules/inspire/llm/providers/gemini";
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

const geminiProfile: AIProfile = {
  id: "g1",
  name: "Gemini",
  provider: "gemini",
  baseURL: "https://generativelanguage.googleapis.com",
  model: "gemini-1.5-flash",
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

  it("rejects baseURL without scheme", () => {
    expect(() => normalizeOpenAICompatibleEndpoint("x.y/v1")).toThrowError(
      LLMError,
    );
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
    expect(res.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
    fetchMock.mockRestore();
  });

  it("sends image inputs as chat content parts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await openaiCompatibleComplete({
      profile: dummyProfile,
      apiKey: "sk-test",
      user: "hi",
      images: [{ mimeType: "image/png", data: "AA==" }],
      temperature: 0,
      maxOutputTokens: 10,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const msgs = Array.isArray(body?.messages) ? body.messages : [];
    const content = msgs[msgs.length - 1]?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]?.type).toBe("image_url");
    expect(content[0]?.image_url?.url).toBe("data:image/png;base64,AA==");
    expect(content[1]?.type).toBe("text");
    expect(content[1]?.text).toBe("hi");

    fetchMock.mockRestore();
  });

  it("falls back to /chat/completions for documents when /responses is missing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "not found" } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello" } }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const res = await openaiCompatibleComplete({
      profile: dummyProfile,
      apiKey: "sk-test",
      user: "hi",
      documents: [{ mimeType: "application/pdf", data: "AA==", filename: "x.pdf" }],
      temperature: 0,
      maxOutputTokens: 10,
    });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("/responses");
    expect(urls[1]).toContain("/chat/completions");
    expect(res.text).toBe("hello");
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });
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

  it("does not fall back to /chat/completions on 401 for documents", async () => {
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
        documents: [{ mimeType: "application/pdf", data: "AA==" }],
      }),
    ).rejects.toMatchObject<Partial<LLMError>>({
      name: "LLMError",
      code: "unauthorized",
      status: 401,
    });

    expect(fetchMock.mock.calls.length).toBe(1);
    fetchMock.mockRestore();
  });

  it("injects DeepSeek thinking mode extra body for DeepSeek profiles", async () => {
    const deepseekProfile: AIProfile = {
      id: "ds1",
      name: "DeepSeek",
      provider: "openaiCompatible",
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      preset: "deepseek",
      createdAt: Date.now(),
    };

    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await openaiCompatibleComplete({
      profile: deepseekProfile,
      apiKey: "sk-test",
      user: "hi",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    expect(body?.thinking).toEqual({ type: "enabled" });
    fetchMock.mockRestore();
  });

  it("retries /files upload with file-extract when purpose is rejected", async () => {
    const profile: AIProfile = {
      ...dummyProfile,
      baseURL: "https://api.example.com/v1",
      model: "test-model",
    };

    let chatCalls = 0;
    const filePurposes: string[] = [];

    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockImplementation(async (input: any, init?: RequestInit) => {
        const url = String(input || "");

        if (url.endsWith("/responses")) {
          return new Response(JSON.stringify({ error: { message: "not found" } }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.endsWith("/chat/completions")) {
          chatCalls++;
          if (chatCalls === 1) {
            return new Response(
              JSON.stringify({ error: { message: "unsupported file_data" } }),
              { status: 415, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "hello" } }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.endsWith("/files")) {
          const body: any = (init as any)?.body;
          const purpose = body?.get?.("purpose");
          filePurposes.push(String(purpose || ""));

          if (purpose === "assistants") {
            return new Response(
              JSON.stringify({
                error: {
                  message:
                    "Invalid purpose: assistants, only `file-extract` accepted",
                },
              }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          if (purpose === "file-extract") {
            return new Response(JSON.stringify({ id: "file_123" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ error: { message: "bad purpose" } }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ error: { message: "unexpected url" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      });

    const res = await openaiCompatibleComplete({
      profile,
      apiKey: "sk-test",
      user: "hi",
      documents: [{ mimeType: "application/pdf", data: "AA==", filename: "x.pdf" }],
    });

    expect(res.text).toBe("hello");
    expect(filePurposes).toEqual(["assistants", "file-extract"]);
    fetchMock.mockRestore();
  });

  it("uses Moonshot file-extract content instead of input_file parts", async () => {
    const moonshotProfile: AIProfile = {
      ...dummyProfile,
      baseURL: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
      preset: "kimi",
    };

    const chatPayloads: any[] = [];

    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockImplementation(async (input: any, init?: RequestInit) => {
        const url = String(input || "");

        if (url.endsWith("/files")) {
          return new Response(JSON.stringify({ id: "file_123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.endsWith("/files/file_123/content")) {
          return new Response(JSON.stringify("extracted text"), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.endsWith("/chat/completions")) {
          chatPayloads.push(
            init?.body ? JSON.parse(String(init.body)) : undefined,
          );
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "hello" } }],
              usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ error: { message: "unexpected url" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      });

    const res = await openaiCompatibleComplete({
      profile: moonshotProfile,
      apiKey: "sk-test",
      user: "hi",
      documents: [{ mimeType: "application/pdf", data: "AA==", filename: "x.pdf" }],
    });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).not.toContain("https://api.moonshot.cn/v1/responses");
    expect(urls[0]).toContain("/files");
    expect(urls[1]).toContain("/files/file_123/content");
    expect(urls[2]).toContain("/chat/completions");

    const payload = chatPayloads[0];
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("input_file");
    expect(serialized).toContain("extracted text");
    expect(res.text).toBe("hello");

    fetchMock.mockRestore();
  });
});

describe("geminiStream", () => {
  it("streams delta content and returns full text", async () => {
    const chunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\n',
      "data: [DONE]\n",
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValue(new Response(stream, { status: 200 }));

    const deltas: string[] = [];
    const res = await geminiStream({
      profile: geminiProfile,
      apiKey: "key-test",
      user: "hi",
      onDelta: (d) => deltas.push(d),
      maxOutputTokens: 10,
    });

    expect(deltas.join("")).toBe("Hello");
    expect(res.text).toBe("Hello");
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

    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValue(new Response(stream, { status: 200 }));

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

  it("sends image inputs as chat content parts (streaming)", async () => {
    const payload = {
      choices: [{ message: { content: "Hello" } }],
    };

    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const deltas: string[] = [];
    const res = await openaiCompatibleStream({
      profile: dummyProfile,
      apiKey: "sk-test",
      user: "hi",
      images: [{ mimeType: "image/png", data: "AA==" }],
      onDelta: (d) => deltas.push(d),
      maxOutputTokens: 10,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const msgs = Array.isArray(body?.messages) ? body.messages : [];
    const content = msgs[msgs.length - 1]?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]?.type).toBe("image_url");
    expect(content[0]?.image_url?.url).toBe("data:image/png;base64,AA==");
    expect(content[1]?.type).toBe("text");
    expect(content[1]?.text).toBe("hi");

    expect(deltas.join("")).toBe("Hello");
    expect(res.text).toBe("Hello");

    fetchMock.mockRestore();
  });

  it("falls back to JSON when server ignores stream", async () => {
    const payload = {
      choices: [{ message: { content: "Hello" } }],
    };

    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
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

  it("streams Responses API style output_text deltas", async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}\n',
      'data: {"type":"response.output_text.delta","delta":"lo"}\n',
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

  it("streams JSONL without SSE data prefix", async () => {
    const chunks = [
      '{"choices":[{"delta":{"content":"Hel"}}]}\n',
      '{"choices":[{"delta":{"content":"lo"}}]}\n',
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

  it("streams Moonshot file-extract docs without input_file parts", async () => {
    const moonshotProfile: AIProfile = {
      ...dummyProfile,
      baseURL: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
      preset: "kimi",
    };

    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      "data: [DONE]\n",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });

    const chatPayloads: any[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockImplementation(async (input: any, init?: RequestInit) => {
        const url = String(input || "");

        if (url.endsWith("/files")) {
          return new Response(JSON.stringify({ id: "file_123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.endsWith("/files/file_123/content")) {
          return new Response(JSON.stringify("extracted text"), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url.endsWith("/chat/completions")) {
          chatPayloads.push(
            init?.body ? JSON.parse(String(init.body)) : undefined,
          );
          return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        return new Response(JSON.stringify({ error: { message: "unexpected url" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      });

    const deltas: string[] = [];
    const res = await openaiCompatibleStream({
      profile: moonshotProfile,
      apiKey: "sk-test",
      user: "hi",
      documents: [{ mimeType: "application/pdf", data: "AA==", filename: "x.pdf" }],
      onDelta: (d) => deltas.push(d),
      maxOutputTokens: 10,
    });

    expect(deltas.join("")).toBe("Hello");
    expect(res.text).toBe("Hello");

    const serialized = JSON.stringify(chatPayloads[0]);
    expect(serialized).not.toContain("input_file");
    expect(serialized).toContain("extracted text");

    fetchMock.mockRestore();
  });
});
