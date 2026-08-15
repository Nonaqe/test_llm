/**
 * Structure-aware чанкинг (docs/12 §3): разрыв по заголовкам и абзацам,
 * целевой размер 300–700 «токенов» (~1200–2800 символов), перекрытие ~15%.
 * Чистая функция над текстом.
 */
export interface Chunk {
  content: string;
  tokenCount: number;
  heading: string | null;
}

const TARGET_CHARS = 2000;
const MAX_CHARS = 2800;
const OVERLAP_CHARS = 300;

/** Приближение: 1 токен ≈ 4 символа (кириллица/латиница вперемешку). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Заголовок: markdown-#, или строка < 80 символов без точки, окружённая пустыми. */
function detectHeading(paragraph: string): string | null {
  const md = /^(#{1,6})\s+(.*)$/.exec(paragraph);
  if (md) return md[2]!.trim();
  if (paragraph.length <= 80 && !/[.!?]$/.test(paragraph) && paragraph === paragraph.toUpperCase()) {
    return paragraph;
  }
  return null;
}

export function chunkText(source: string): Chunk[] {
  const paragraphs = splitParagraphs(source.replace(/\r\n/g, "\n"));
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let heading: string | null = null;

  const flush = (): void => {
    if (current.length === 0) return;
    const content = current.join("\n\n").slice(0, MAX_CHARS).trim();
    if (content) {
      chunks.push({ content, tokenCount: approxTokens(content), heading });
    }
    // перекрытие: последний абзац уезжает в начало следующего чанка
    const tail = current[current.length - 1] ?? "";
    if (tail.length <= OVERLAP_CHARS) {
      current = [tail];
      currentLen = tail.length;
    } else {
      current = [tail.slice(tail.length - OVERLAP_CHARS)];
      currentLen = current[0]!.length;
    }
  };

  for (const paragraph of paragraphs) {
    const h = detectHeading(paragraph);
    if (h) {
      flush();
      heading = h;
      current = [];
      currentLen = 0;
      continue;
    }
    if (currentLen + paragraph.length > TARGET_CHARS) {
      flush();
    }
    current.push(paragraph);
    currentLen += paragraph.length + 2;
  }
  flush();

  // хвостовой чанк-дубликат без контента после последнего flush
  const last = chunks[chunks.length - 1];
  const dangling = current.join("\n\n").trim();
  if (dangling && (!last || last.content !== dangling)) {
    chunks.push({
      content: dangling.slice(0, MAX_CHARS),
      tokenCount: approxTokens(dangling),
      heading,
    });
  }
  return chunks.filter((c) => c.content.length >= 20);
}
