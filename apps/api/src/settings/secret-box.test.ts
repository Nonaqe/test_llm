import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret-box";

const SECRET = "0123456789abcdef";

describe("secret-box: AES-256-GCM (docs/17 §4)", () => {
  it("roundtrip: расшифровка восстанавливает значение", () => {
    const packed = encryptSecret("sk-live-abc123", SECRET);
    expect(decryptSecret(packed, SECRET)).toBe("sk-live-abc123");
  });

  it("шифрование не содержит открытый текст", () => {
    const packed = encryptSecret("sk-live-abc123", SECRET);
    expect(packed).not.toContain("sk-live-abc123");
  });

  it("каждое шифрование — новый IV (разные шифротексты)", () => {
    const a = encryptSecret("same", SECRET);
    const b = encryptSecret("same", SECRET);
    expect(a).not.toBe(b);
  });

  it("неверный APP_SECRET не расшифровывает (GCM-тег)", () => {
    const packed = encryptSecret("secret", SECRET);
    expect(() => decryptSecret(packed, "fedcba9876543210")).toThrow();
  });

  it("подмена шифротекста обнаруживается", () => {
    const packed = encryptSecret("secret", SECRET);
    const parts = packed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), SECRET)).toThrow();
  });

  it("isEncryptedSecret распознаёт формат", () => {
    expect(isEncryptedSecret(encryptSecret("x", SECRET))).toBe(true);
    expect(isEncryptedSecret("plain")).toBe(false);
  });
});
