/**
 * SSRF-защита URL-ингестии (docs/15 §3): только http(s), DNS-резолв → блок
 * приватных диапазонов, ручные редиректы с ревалидацией, лимиты размера/времени.
 */
import { lookup } from "node:dns/promises";

export type LookupFn = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: LookupFn = async (hostname) => lookup(hostname, { all: true });

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"))
      return true; // fe80::/10 link-local
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIp(mapped[1]!);
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // кривой адрес — блокируем
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + metadata 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export async function assertPublicHttpUrl(raw: string, lookupFn: LookupFn = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ONLY_HTTPS_HTTP_ALLOWED");
  }
  // IP-литерал или имя — всё равно резолвим и проверяем все адреса
  const records = await lookupFn(url.hostname).catch(() => {
    throw new Error("DNS_RESOLVE_FAILED");
  });
  if (records.length === 0) throw new Error("DNS_RESOLVE_FAILED");
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error("PRIVATE_ADDRESS_BLOCKED");
  }
  return url;
}

export interface FetchedPage {
  text: string;
  contentType: string;
  finalUrl: string;
}

export async function fetchWithSsrfGuard(
  rawUrl: string,
  opts: { maxRedirects?: number; maxSizeBytes?: number; timeoutMs?: number } = {},
): Promise<FetchedPage> {
  const { maxRedirects = 3, maxSizeBytes = 5 * 1024 * 1024, timeoutMs = 10_000 } = opts;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: "manual", signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION");
        current = new URL(location, url).toString(); // относительные редиректы
        continue;
      }
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxSizeBytes) throw new Error("TOO_LARGE");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("EMPTY_BODY");
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value!.byteLength;
        if (received > maxSizeBytes) {
          await reader.cancel();
          throw new Error("TOO_LARGE");
        }
        chunks.push(value!);
      }
      const buffer = Buffer.concat(chunks);
      return {
        text: buffer.toString("utf8"),
        contentType: res.headers.get("content-type") ?? "",
        finalUrl: url.toString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("TOO_MANY_REDIRECTS");
}
