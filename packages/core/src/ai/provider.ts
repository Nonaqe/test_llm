/**
 * Интерфейсы AI-провайдеров (docs/11 §1): ядро знает только контракты.
 * Реализации: FakeProvider (тесты/CI) и OpenAiCompatibleProvider (apps/api).
 */
import type { RetrievedChunk } from "../rag/rrf";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmStreamChunk {
  token: string;
}

/** Финальный ответ LLM — строго JSON схемы StructuredAiAnswer (docs/11 §4). */
export interface LlmStreamResult {
  raw: string;
}

export interface LlmProvider {
  readonly name: string;
  chatStream(
    messages: ChatMessage[],
    options?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
  ): AsyncIterable<LlmStreamChunk> & { result(): Promise<LlmStreamResult> };
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Контекстный чанк, передаваемый в промпт (docs/11 §3). */
export type PromptChunk = RetrievedChunk;
