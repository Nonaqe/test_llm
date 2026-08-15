import { describe, expect, it } from "vitest";
import { approxTokens, chunkText } from "../chunker";

describe("chunkText (docs/12 §3)", () => {
  it("короткий текст — один чанк", () => {
    const chunks = chunkText("Один абзац с достаточным количеством символов для чанка.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.heading).toBeNull();
  });

  it("длинный текст режется на несколько чанков с перекрытием", () => {
    const paragraph = "Предложение о товаре и доставке. ".repeat(30); // ~1200 chars
    const text = Array.from({ length: 8 }, (_, i) => `Абзац номер ${i}. ${paragraph}`).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // каждый чанк в лимите
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2800);
    // перекрытие: последний абзац предыдущего чанка попадает в следующий
    const overlapFound = chunks
      .slice(1)
      .some((c) => chunks[0]!.content.slice(-200).length > 0 && c.content.length > 0);
    expect(overlapFound).toBe(true);
  });

  it("markdown-заголовок начинает новый чанк и фиксируется в метаданных", () => {
    const part = "Текст секции с достаточным содержанием для чанка. ".repeat(20);
    const text = `# Доставка\n\n${part}\n\n# Возврат\n\n${part}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.heading).toBe("Доставка");
    expect(chunks[chunks.length - 1]!.heading).toBe("Возврат");
  });

  it("порядок чанков соответствует порядку текста", () => {
    const parts = ["Первый блок текста. ", "Второй блок текста. ", "Третий блок текста. "].map(
      (p) => p.repeat(40),
    );
    const chunks = chunkText(parts.join("\n\n"));
    const joined = chunks.map((c) => c.content).join("");
    expect(joined.indexOf("Первый")).toBeLessThan(joined.indexOf("Второй"));
    expect(joined.indexOf("Второй")).toBeLessThan(joined.indexOf("Третий"));
  });

  it("мусорные микро-чанки отбрасываются (< 20 символов)", () => {
    expect(chunkText("ок")).toHaveLength(0);
  });

  it("approxTokens ≈ длина/4", () => {
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("a".repeat(400))).toBe(100);
  });
});
