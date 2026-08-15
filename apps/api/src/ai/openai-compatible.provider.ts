/**
 * OpenAI-compatible провайдер (ADR-005, docs/11 §1): /chat/completions (SSE-стрим)
 * и /embeddings через fetch — покрывает OpenAI/OpenRouter/DeepSeek/Groq/vLLM/Ollama.
 */
import type {
  ChatMessage,
  EmbeddingProvider,
  LlmProvider,
  LlmStreamChunk,
  LlmStreamResult,
} from "@uni-chat/core";
import type { RetrievedChunk } from "@uni-chat/core";

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name = "openai_compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  chatStream(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
  ): AsyncIterable<LlmStreamChunk> & { result(): Promise<LlmStreamResult> } {
    let raw = "";

    const iterate = async function* (
      self: OpenAiCompatibleLlmProvider,
    ): AsyncGenerator<LlmStreamChunk> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
      try {
        const res = await fetch(`${self.baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${self.apiKey}`,
          },
          body: JSON.stringify({
            model: self.model,
            messages,
            stream: true,
            temperature: options.temperature ?? 0.2,
            max_tokens: options.maxTokens ?? 1024,
          }),
        });
        if (!res.ok || !res.body) {
          const body = await res.text().catch(() => "");
          throw new Error(`LLM_HTTP_${res.status}: ${body.slice(0, 300)}`);
        }
        const reader = res.body.getReader()!;
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") return;
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const token = json.choices?.[0]?.delta?.content;
              if (token) {
                raw += token;
                yield { token };
              }
            } catch {
              /* незавершённый SSE-фрагмент — допустимо */
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    };

    const iterator = iterate(this);
    return {
      [Symbol.asyncIterator]: () => iterator,
      result: async () => {
        for await (const _ of iterator) {
          void _;
        }
        return { raw };
      },
    };
  }
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai_compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    readonly dimension: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`EMBEDDINGS_HTTP_${res.status}: ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        data: Array<{ index: number; embedding: number[] }>;
      };
      return json.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
    } finally {
      clearTimeout(timer);
    }
  }
}

export type { RetrievedChunk };
