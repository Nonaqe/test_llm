import { describe, expect, it } from "vitest";
import { csvToText, detectKind, htmlToText } from "./parsers";
import { normalizeText } from "./normalize";

describe("detectKind (docs/12 §1)", () => {
  it("по расширению", () => {
    expect(detectKind("doc.pdf", "application/pdf")).toBe("pdf");
    expect(detectKind("report.DOCX", "x")).toBe("docx");
    expect(detectKind("notes.md", "text/plain")).toBe("md");
    expect(detectKind("data.csv", "text/csv")).toBe("csv");
  });

  it("по mime при отсутствии расширения", () => {
    expect(detectKind("noext", "application/pdf")).toBe("pdf");
    expect(detectKind("noext", "text/html")).toBe("html");
  });

  it("неизвестное → null", () => {
    expect(detectKind("file.exe", "application/octet-stream")).toBeNull();
  });
});

describe("csvToText", () => {
  it("строки → «Колонка: значение» с учётом кавычек", () => {
    const csv = 'название,цена\n"Товар ""А""",500\nТовар Б,700';
    const text = csvToText(csv);
    expect(text).toContain('название: Товар "А"');
    expect(text).toContain("цена: 500");
    expect(text).toContain("название: Товар Б");
  });
});

describe("htmlToText", () => {
  it("script/style вырезаются, теги → пробелы, сущности декодируются", () => {
    const html = `<html><head><script>alert(1)</script><style>.a{}</style></head>
      <body><h1>Заголовок</h1><p>Текст &amp; больше&#39;</p></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain(".a{}");
    expect(text).toContain("Заголовок");
    expect(text).toContain("Текст & больше'");
  });
});

describe("normalizeText", () => {
  it("схлопывает пробелы и лишние пустые строки", () => {
    expect(normalizeText("а  б\tв\n\n\n\nг  \n")).toBe("а б в\n\nг");
  });
});
