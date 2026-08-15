import { describe, expect, it } from "vitest";
import {
  FakeEmbeddingProvider,
  FakeLlmProvider,
  FAKE_EMBEDDING_DIM,
  fakeEmbedding,
} from "../fake-provider";

describe("FakeEmbeddingProvider (docs/18 — fake для CI)", () => {
  it("размерность 1536 совпадает со схемой vector(1536)", () => {
    expect(FAKE_EMBEDDING_DIM).toBe(1536);
    const provider = new FakeEmbeddingProvider();
    expect(provider.dimension).toBe(1536);
  });

  it("детерминирован", async () => {
    const provider = new FakeEmbeddingProvider();
    const [a1, a2] = await provider.embed(["доставка товара", "доставка товара"]);
    expect(a1).toEqual(a2);
    expect(a1).toEqual(fakeEmbedding("доставка товара"));
  });

  it("лексически близкие тексты дают высокую косинусную близость", async () => {
    const provider = new FakeEmbeddingProvider();
    const [near] = await provider.embed(["доставка товара занимает два дня"]);
    const [same] = await provider.embed(["доставка товара"]);
    const [far] = await provider.embed(["погода на марсе сегодня"]);
    const cos = (a: number[], b: number[]) =>
      a.reduce((s, v, i) => s + v * b[i]!, 0);
    expect(cos(near, same)).toBeGreaterThan(cos(near, far));
  });

  it("норма вектора = 1", () => {
    const v = fakeEmbeding_norm("тест нормализации вектора");
    expect(v).toBeCloseTo(1, 5);
  });
});

function fakeEmbeding_norm(text: string): number {
  const v = fakeEmbedding(text);
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

describe("FakeLlmProvider", () => {
  it("стримит токены и отдаёт валидный structured output", async () => {
    const provider = new FakeLlmProvider();
    const context = "<<<CONTEXT_BLOCK 1 source=doc:d1\nДоставка занимает два дня. Курьер звонит заранее. [источник]\nCONTEXT_BLOCK>>>";
    const stream = provider.chatStream([
      { role: "system", content: "sys" },
      { role: "user", content: `вопрос\n\n${context}` },
    ]);
    let tokens = 0;
    for await (const chunk of stream) {
      void chunk;
      tokens += 1;
    }
    const result = await stream.result();
    expect(tokens).toBeGreaterThan(1); // стриминг по словам
    expect(result.raw).toContain("Доставка занимает два дня");
    expect(() => JSON.parse(result.raw)).not.toThrow();
    const parsed = JSON.parse(result.raw) as { answer: string; confidence: number };
    expect(parsed.answer).toContain("[1]");
    expect(parsed.confidence).toBeGreaterThan(0);
  });
});
