/**
 * Fake-провайдер (docs/11 §1, docs/18): детерминированные эмбеддинги
 * (hashing trick — лексическая близость) и чат-ответы на основе контекста.
 * Единственный провайдер в CI — реальный API не вызывается.
 */
import type {
  ChatMessage,
  EmbeddingProvider,
  LlmProvider,
  LlmStreamChunk,
  LlmStreamResult,
} from "./provider";
import type { RetrievedChunk } from "../rag/rrf";
import { buildContextBlocks } from "./prompt-builder";

export const FAKE_EMBEDDING_DIM = 1536;

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/iu)
    .filter((t) => t.length > 1);
}

/** Hashing-эмбеддинг: слово → измерение; лексически похожие тексты дают близкие векторы. */
export function fakeEmbedding(text: string): number[] {
  const vec = new Array<number>(FAKE_EMBEDDING_DIM).fill(0);
  for (const token of tokenize(text)) {
    const index = hashString(token) % FAKE_EMBEDDING_DIM;
    vec[index] = (vec[index] ?? 0) + 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake";
  readonly dimension = FAKE_EMBEDDING_DIM;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(fakeEmbedding);
  }
}

/**
 * Чат: answer = первые предложения лучшего контекстного чанка + [1].
 * Детерминирован; стримит по словам с задержкой STREAM_DELAY_MS.
 */
export const FAKE_STREAM_DELAY_MS = 10;

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";

  chatStream(messages: ChatMessage[]): AsyncIterable<LlmStreamChunk> & {
    result(): Promise<LlmStreamResult>;
  } {
    const context = messages
      .filter((m) => m.role === "user" && m.content.includes("<<<CONTEXT_BLOCK"))
      .map((m) => m.content)
      .join("\n\n");
    const chunks = parseContextChunks(context);
    const answer = this.buildAnswer(chunks);
    const raw = JSON.stringify({
      answer,
      confidence: 0.87,
      user_intent_flags: { wants_human: false, complaint: false },
      detected_intent: "faq",
    });

    let done = false;
    async function* iterate(): AsyncGenerator<LlmStreamChunk> {
      for (const token of answer.match(/\S+\s*/g) ?? []) {
        await new Promise((r) => setTimeout(r, FAKE_STREAM_DELAY_MS));
        yield { token };
      }
      done = true;
    }
    const iterator = iterate();
    const stream: AsyncIterable<LlmStreamChunk> & { result(): Promise<LlmStreamResult> } = {
      [Symbol.asyncIterator]() {
        return iterator;
      },
      result: async () => {
        for await (const _ of iterator) {
          void _;
        }
        if (!done) throw new Error("result() до завершения стрима");
        return { raw };
      },
    };
    return stream;
  }

  private buildAnswer(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) {
      return "Ответа нет в базе знаний. [0]";
    }
    const best = chunks[0]!;
    const sentences = best.content.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    return `${sentences} [1]`;
  }
}

function parseContextBlocks(context: string): string[] {
  const re = /<<<CONTEXT_BLOCK[\s\S]*?\n([\s\S]*?)\nCONTEXT_BLOCK>>>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(context)) !== null) out.push(m[1]!);
  return out;
}

function parseContextChunks(context: string): RetrievedChunk[] {
  return parseContextBlocks(context).map((content, i) => ({
    chunkId: `fake-${i}`,
    sourceDocumentId: `fake-doc-${i}`,
    sourceFaqId: null,
    content,
    metadata: {},
    cosine: 1,
    rrfScore: 1,
  }));
}

export { buildContextBlocks };
