import { describe, expect, it } from "vitest";
import {
  buildContextBlocks,
  buildHistoryMessages,
  buildSystemPrompt,
  type AssistantPersona,
} from "../prompt-builder";

const base: AssistantPersona = {
  name: "Консультант",
  locale: "ru",
  tone: "professional",
  companyDescription: "Магазин мебели «Сосна».",
  customInstructions: "Не давай медицинских советов.",
  deniedTopics: ["политика"],
  fallbackMessage: "",
};

describe("buildSystemPrompt (docs/11 §3)", () => {
  it("снапшот: базовый промпт", () => {
    expect(buildSystemPrompt(base)).toMatchInlineSnapshot(`
      "Ты — Консультант, чат-консультант на сайте компании.
      Язык ответов: ru. Тон: professional.
      Описание компании: Магазин мебели «Сосна».
      Дополнительные инструкции: Не давай медицинских советов.

      ЖЁСТКИЕ ПРАВИЛА:
      - Отвечай ТОЛЬКО на основе блоков КОНТЕКСТ ниже.
      - Нет информации в КОНТЕКСТ — так и скажи, не придумывай цены, сроки, наличие и условия.
      - Ссылайся на источники номерами [1], [2] в конце утверждений.
      - Запрещённые темы (вежливо откажи): политика.

      ФОРМАТ ОТВЕТА — строго JSON:
      {"answer": "текст", "confidence": 0.0-1.0, "user_intent_flags": {"wants_human": false, "complaint": false}, "detected_intent": "строка"}"
    `);
  });

  it("пустые опции не оставляют пустых строк-заглушек", () => {
    const prompt = buildSystemPrompt({ ...base, companyDescription: "", customInstructions: "", deniedTopics: [] });
    expect(prompt).not.toContain("Описание компании:");
    expect(prompt).not.toContain("Дополнительные инструкции:");
    expect(prompt).not.toContain("Запрещённые темы");
  });
});

describe("buildContextBlocks (docs/11 §6 — контент как данные)", () => {
  it("блоки нумерованы и обёрнуты делимитерами с источником", () => {
    const text = buildContextBlocks([
      {
        chunkId: "c1",
        sourceDocumentId: "d1",
        sourceFaqId: null,
        content: "Доставка 2 дня.",
        metadata: {},
        cosine: 0.8,
        rrfScore: 0.03,
      },
      {
        chunkId: "c2",
        sourceDocumentId: null,
        sourceFaqId: "f1",
        content: "Возврат 14 дней.",
        metadata: {},
        cosine: 0.7,
        rrfScore: 0.02,
      },
    ]);
    expect(text).toContain("<<<CONTEXT_BLOCK 1 source=doc:d1");
    expect(text).toContain("Доставка 2 дня.");
    expect(text).toContain("<<<CONTEXT_BLOCK 2 source=faq:f1");
    expect(text).toContain("CONTEXT_BLOCK>>>");
  });
});

describe("buildHistoryMessages", () => {
  it("visitor→user, assistant→assistant; system/note отбрасываются; глубина соблюдается", () => {
    const history = [
      { role: "system" as const, content: "sys" },
      { role: "visitor" as const, content: "q1" },
      { role: "assistant" as const, content: "a1" },
      { role: "visitor" as const, content: "q2" },
      { role: "assistant" as const, content: "a2" },
      { role: "visitor" as const, content: "q3" },
    ];
    const msgs = buildHistoryMessages(history, 2);
    expect(msgs).toEqual([
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
    ]);
    const msgs4 = buildHistoryMessages(history, 4);
    expect(msgs4).toEqual([
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
    ]);
  });
});
