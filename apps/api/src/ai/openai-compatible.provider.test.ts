/**
 * Юнит-тесты боевого AI-провайдера (аудит IR-059: единственный не-fake путь
 * не был покрыт — регрессии SSE-парсинга ловил только прод).
 * fetch подменяется глобально; поток скармливается чанками с разрывами.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAiCompatibleEmbeddingProvider,
  OpenAiCompatibleLlmProvider,
} from "./openai-compatible.provider";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** SSE-ответ из строк; каждая отдаётся отдельным read() (разрывы посреди данных) */
function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= lines.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(lines[i]!));
      i += 1;
    },
  });
  return new Response(body, { status: 200 });
}

const chatChunk = (token: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`;

describe("OpenAiCompatibleLlmProvider.chatStream", () => {
  it("собирает полный текст из SSE-чанков, разорванных посреди JSON", async () => {
    // второй фрагмент — «обрезанный» JSON: буфер обязан склеить строки
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"cont',
        'ent":"При"}}]}\n\n',
        chatChunk("вет,"),
        " \n",
        chatChunk("мир"),
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAiCompatibleLlmProvider("https://llm.test/v1", "sk-test", "m");
    const result = await provider.chatStream([{ role: "user", content: "hi" }]).result();
    expect(result.raw).toBe("Привет,мир");
  });

  it("игнорирует SSE-строки без data: и пустые delta", async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        ": keep-alive комментарий\n\n",
        'data: {"choices":[{"delta":{}}]}\n\n',
        chatChunk("ок"),
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAiCompatibleLlmProvider("https://llm.test/v1", "sk-test", "m");
    const result = await provider.chatStream([{ role: "user", content: "x" }]).result();
    expect(result.raw).toBe("ок");
  });

  it("HTTP-ошибка провайдера → LLM_HTTP_<status>", async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"error":"quota"}', { status: 402 }));
    const provider = new OpenAiCompatibleLlmProvider("https://llm.test/v1", "sk-test", "m");
    await expect(
      provider.chatStream([{ role: "user", content: "x" }]).result(),
    ).rejects.toThrow("LLM_HTTP_402");
  });

  it("abort по timeoutMs прерывает запрос", async () => {
    let capturedSignal: AbortSignal | null = null;
    globalThis.fetch = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init?.signal ?? null;
          capturedSignal?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted")),
          );
        }) as never,
    );
    const provider = new OpenAiCompatibleLlmProvider("https://llm.test/v1", "sk-test", "m");
    await expect(
      provider.chatStream([{ role: "user", content: "x" }], { timeoutMs: 30 }).result(),
    ).rejects.toThrow();
    expect(capturedSignal).not.toBeNull();
  });

  it("отправляет Authorization и stream:true в тело запроса", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([chatChunk("a"), "data: [DONE]\n\n"]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const provider = new OpenAiCompatibleLlmProvider("https://llm.test/v1", "sk-secret", "model-x");
    await provider
      .chatStream([{ role: "user", content: "?" }], { temperature: 0.7, maxTokens: 55 })
      .result();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-secret");
    const parsedBody = JSON.parse(init.body) as { model: string; stream: boolean; temperature: number; max_tokens: number };
    expect(parsedBody.model).toBe("model-x");
    expect(parsedBody.stream).toBe(true);
    expect(parsedBody.temperature).toBe(0.7);
    expect(parsedBody.max_tokens).toBe(55);
  });
});

describe("OpenAiCompatibleEmbeddingProvider.embed", () => {
  it("возвращает векторы в порядке index, а не порядке ответа", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        {
          data: [
            { index: 2, embedding: [0.3, 0.3] },
            { index: 0, embedding: [0.1, 0.1] },
            { index: 1, embedding: [0.2, 0.2] },
          ],
        },
        { status: 200 },
      ),
    );
    const provider = new OpenAiCompatibleEmbeddingProvider(
      "https://llm.test/v1",
      "sk-test",
      "emb",
      2,
    );
    const vectors = await provider.embed(["a", "b", "c"]);
    expect(vectors.map((v) => v[0])).toEqual([0.1, 0.2, 0.3]);
  });

  it("HTTP-ошибка → EMBEDDINGS_HTTP_<status>", async () => {
    globalThis.fetch = vi.fn(async () => new Response("denied", { status: 401 }));
    const provider = new OpenAiCompatibleEmbeddingProvider(
      "https://llm.test/v1",
      "bad-key",
      "emb",
      2,
    );
    await expect(provider.embed(["a"])).rejects.toThrow("EMBEDDINGS_HTTP_401");
  });
});
