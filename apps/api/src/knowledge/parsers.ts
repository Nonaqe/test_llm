/**
 * Парсеры источников знаний (docs/12 §1): txt/md/csv/html — чистый JS;
 * pdf (pdfjs-dist, текст-слой обязателен) и docx (mammoth).
 */
import { normalizeText } from "./normalize";

export type SourceKind = "txt" | "md" | "csv" | "html" | "pdf" | "docx";

const BY_EXTENSION: Record<string, SourceKind> = {
  ".txt": "txt",
  ".md": "md",
  ".markdown": "md",
  ".csv": "csv",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".docx": "docx",
};

export function detectKind(filename: string, mime: string): SourceKind | null {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  const byExt = BY_EXTENSION[ext];
  if (byExt) return byExt;
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("wordprocessingml")) return "docx";
  if (mime === "text/html") return "html";
  if (mime === "text/csv") return "csv";
  if (mime.startsWith("text/")) return "txt";
  return null;
}

export async function extractText(kind: SourceKind, buffer: Buffer): Promise<string> {
  switch (kind) {
    case "txt":
    case "md":
      return normalizeText(buffer.toString("utf8"));
    case "csv":
      return normalizeText(csvToText(buffer.toString("utf8")));
    case "html":
      return normalizeText(htmlToText(buffer.toString("utf8")));
    case "pdf":
      return normalizeText(await pdfToText(buffer));
    case "docx":
      return normalizeText(await docxToText(buffer));
  }
}

/** CSV → линейный текст «Колонка: значение» (основа будущих «товаров» — docs/12 §1). */
export function csvToText(csv: string): string {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return "";
  const header = rows[0]!;
  const lines: string[] = [];
  for (const row of rows.slice(1)) {
    const pairs = row
      .map((value, i) => (header[i] ? `${header[i]}: ${value}` : value))
      .filter((p) => /:\s*\S/.test(p));
    if (pairs.length > 0) lines.push(pairs.join("; "));
  }
  return lines.join("\n");
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
;
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (ent) => ENTITIES[ent.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ");
}

async function pdfToText(buffer: Buffer): Promise<string> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useWorkerFetch: false,
  }).promise;
  const parts: string[] = [];
  for (let page = 1; page <= doc.numPages; page++) {
    const pageObj = await doc.getPage(page);
    const content = await pageObj.getTextContent();
    parts.push(content.items.map((item) => item.str ?? "").join(" "));
  }
  const text = parts.join("\n\n");
  if (!text.replace(/\s+/g, "").length) {
    // скан без текст-слоя — честный статус (docs/12 §1)
    throw new Error("no text layer: PDF, вероятно, скан (OCR — V2)");
  }
  return text;
}

interface PdfJsModule {
  getDocument: (opts: unknown) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }> }> };
}

/**
 * Загрузка ESM pdfjs из CJS-сборки. В проде (node dist/main.js) tsc превратил бы
 * import() в require → нужен нативный import через new Function. Под vitest код
 * исполняется в VM-контексте без support dynamic import в new Function — там
 * работает прямой import(), который трансформирует загрузчик vitest.
 */
async function loadPdfjs(): Promise<PdfJsModule> {
  try {
    const dynImport = new Function("m", "return import(m)") as (m: string) => Promise<PdfJsModule>;
    return await dynImport("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (err) {
    if (String((err as Error)?.message ?? "").includes("dynamic import callback")) {
      return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsModule;
    }
    throw err;
  }
}

async function docxToText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}
