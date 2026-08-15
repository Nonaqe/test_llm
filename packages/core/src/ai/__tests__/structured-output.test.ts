import { describe, expect, it } from "vitest";
import { extractJson, fixupInstruction, parseStructuredAnswer } from "../structured-output";

const valid = JSON.stringify({
  answer: "Доставка 2 дня [1].",
  confidence: 0.86,
  user_intent_flags: { wants_human: false, complaint: false },
  detected_intent: "delivery",
});

describe("parseStructuredAnswer (docs/11 §4)", () => {
  it("валидный JSON разбирается", () => {
    const res = parseStructuredAnswer(valid);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.answer).toContain("[1]");
      expect(res.value.confidence).toBeCloseTo(0.86);
      expect(res.value.user_intent_flags.wants_human).toBe(false);
    }
  });

  it("JSON в markdown-заборе извлекается", () => {
    const res = parseStructuredAnswer("```json\n" + valid + "\n```");
    expect(res.ok).toBe(true);
  });

  it("JSON с текстом вокруг извлекается", () => {
    const res = parseStructuredAnswer(`Вот ответ:\n${valid}\nСпасибо!`);
    expect(res.ok).toBe(true);
  });

  it("confidence клампится в [0,1]", () => {
    const res = parseStructuredAnswer(JSON.stringify({ answer: "x", confidence: 7 }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.confidence).toBe(1);
  });

  it("отсутствие JSON — машиночитаемая причина", () => {
    const res = parseStructuredAnswer("Просто текст без JSON");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_json_object");
  });

  it("кривой JSON — причина с путём поля", () => {
    const res = parseStructuredAnswer(JSON.stringify({ answer: "" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("answer");
  });

  it("defaults применяются к отсутствующим полям", () => {
    const res = parseStructuredAnswer(JSON.stringify({ answer: "ок", confidence: 0.5 }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.detected_intent).toBe("");
      expect(res.value.user_intent_flags.complaint).toBe(false);
    }
  });
});

describe("extractJson / fixupInstruction", () => {
  it("extractJson null без объекта", () => {
    expect(extractJson("no braces")).toBeNull();
  });

  it("инструкция фикс-апа содержит причину", () => {
    expect(fixupInstruction("answer: too small")).toContain("answer: too small");
    expect(fixupInstruction("x")).toContain("СТРОГО");
  });
});
