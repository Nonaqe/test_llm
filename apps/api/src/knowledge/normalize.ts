/** Нормализация извлечённого текста (docs/12 §2). */
export function normalizeText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
