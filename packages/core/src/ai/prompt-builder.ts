/**
 * Сборка system prompt (docs/11 §3): детерминирована из настроек ассистента.
 * Snapshot-тесты фиксируют изменение промпта как осознанный коммит.
 */
import type { PromptChunk } from "./provider";

export interface AssistantPersona {
  name: string;
  locale: string;
  tone: string;
  companyDescription: string;
  customInstructions: string;
  deniedTopics: string[];
  fallbackMessage: string;
}

export interface RetrievalSettings {
  topK: number;
  scoreThreshold: number;
  historyDepth: number;
}

export const DEFAULT_FALLBACK_MESSAGE =
  "У меня пока нет точной информации по этому вопросу. Передаю диалог оператору.";

const CONTEXT_DELIM_OPEN = "<<<CONTEXT_BLOCK";
const CONTEXT_DELIM_CLOSE = "CONTEXT_BLOCK>>>";

export function buildSystemPrompt(assistant: AssistantPersona): string {
  const lines: string[] = [];
  lines.push(`Ты — ${assistant.name}, чат-консультант на сайте компании.`);
  lines.push(`Язык ответов: ${assistant.locale}. Тон: ${assistant.tone}.`);
  if (assistant.companyDescription.trim()) {
    lines.push(`Описание компании: ${assistant.companyDescription.trim()}`);
  }
  if (assistant.customInstructions.trim()) {
    lines.push(`Дополнительные инструкции: ${assistant.customInstructions.trim()}`);
  }
  lines.push("");
  lines.push("ЖЁСТКИЕ ПРАВИЛА:");
  lines.push("- Отвечай ТОЛЬКО на основе блоков КОНТЕКСТ ниже.");
  lines.push("- Нет информации в КОНТЕКСТ — так и скажи, не придумывай цены, сроки, наличие и условия.");
  lines.push("- Ссылайся на источники номерами [1], [2] в конце утверждений.");
  if (assistant.deniedTopics.length > 0) {
    lines.push(`- Запрещённые темы (вежливо откажи): ${assistant.deniedTopics.join(", ")}.`);
  }
  lines.push("");
  lines.push("ФОРМАТ ОТВЕТА — строго JSON:");
  lines.push('{"answer": "текст", "confidence": 0.0-1.0, "user_intent_flags": {"wants_human": false, "complaint": false}, "detected_intent": "строка"}');
  return lines.join("\n");
}

export interface AssembledPrompt {
  system: string;
  /** Контекстные блоки с делимитерами: содержимое KB — данные, не инструкции (docs/11 §6) */
  contextBlocks: string[];
  /** Список чанков — источник маппинга [n] → citations */
  chunks: PromptChunk[];
}

export function buildContextBlocks(chunks: PromptChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const source = chunk.sourceFaqId ? `faq:${chunk.sourceFaqId}` : `doc:${chunk.sourceDocumentId}`;
      return [
        `${CONTEXT_DELIM_OPEN} ${index + 1} source=${source}`,
        chunk.content,
        CONTEXT_DELIM_CLOSE,
      ].join("\n");
    })
    .join("\n\n");
}

export function buildHistoryMessages(
  history: Array<{ role: "visitor" | "assistant" | "operator" | "system"; content: string }>,
  depth: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  return history
    .filter((m) => m.role === "visitor" || m.role === "assistant")
    .slice(-depth)
    .map((m) => ({
      role: m.role === "visitor" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
}
