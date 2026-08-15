import { describe, expect, it } from "vitest";
import { matchOrigin, normalizeOrigin } from "./origin";

describe("origin matcher (docs/10 §4)", () => {
  it("точное совпадение после нормализации", () => {
    expect(matchOrigin(["https://example.com"], "https://example.com")).toBe(true);
    expect(matchOrigin(["https://example.com"], "https://example.com/")).toBe(true);
    expect(matchOrigin(["https://Example.COM"], "https://example.com")).toBe(true);
  });

  it("чужой домен отклоняется", () => {
    expect(matchOrigin(["https://example.com"], "https://evil.com")).toBe(false);
  });

  it("поддомен ≠ домен (без wildcard-логики)", () => {
    expect(matchOrigin(["https://example.com"], "https://sub.example.com")).toBe(false);
  });

  it("отсутствующий Origin — отказ (не-браузерные клиенты обязаны слать Origin)", () => {
    expect(matchOrigin(["https://example.com"], undefined)).toBe(false);
  });

  it("'*' разрешает всё (явная конфигурация сайта)", () => {
    expect(matchOrigin(["*"], "https://anything.net")).toBe(true);
    expect(matchOrigin(["*"], undefined)).toBe(true);
  });

  it("пробелы и регистр нормализуются", () => {
    expect(normalizeOrigin("  HTTPS://Example.com/  ")).toBe("https://example.com");
  });
});
