/**
 * Шифрование секретных настроек: AES-256-GCM, ключ выводится из APP_SECRET (docs/17 §4).
 * Формат значения: v1:<iv_b64>:<tag_b64>:<cipher_b64>
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";
const INFO = "unichat-settings-secret";

export function deriveKey(appSecret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", appSecret, Buffer.alloc(0), INFO, 32));
}

export function encryptSecret(plain: string, appSecret: string): string {
  const key = deriveKey(appSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(packed: string, appSecret: string): string {
  const [version, ivB64, tagB64, dataB64] = packed.split(":");
  if (version !== VERSION || ivB64 === undefined || tagB64 === undefined || dataB64 === undefined) {
    throw new Error("invalid secret format");
  }
  const key = deriveKey(appSecret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(":").length === 4;
}
