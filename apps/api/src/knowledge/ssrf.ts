/**
 * SSRF-защита URL-ингестии (docs/15 §3): только http(s), DNS-резолв → блок
 * приватных диапазонов, ручные редиректы с ревалидацией, лимиты размера/времени.
 */
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";

export type LookupFn = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: LookupFn = async (hostname) => lookup(hostname, { all: true });

/** Разворачивает IPv6 в 128-битное число (:: и зоны учитываются); null — не IPv6 */
export function expandIpv6(ip: string): bigint | null {
  const noZone = ip.split("%")[0]!; // зона интерфейса fe80::1%eth0
  // Хвостовая точечная форма (::ffff:10.0.0.1) → два hextet'а
  const dotted = /^((?:[0-9a-fA-F]{0,4}:)+)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(noZone);
  const clean =
    dotted !== null
      ? dottedToHextets(dotted[1]!, dotted[2]!)
      : noZone;
  if (!clean.includes(":")) return null;
  const halves = clean.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0]!.split(":");
  const tail = halves.length === 2 ? (halves[1] === "" ? [] : halves[1]!.split(":")) : [];
  if (halves.length < 2 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups =
    halves.length === 2 ? [...head, ...Array<string>(missing).fill("0"), ...tail] : head;
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/** a.b.c.d → два hextet'а (хвост IPv6-адреса) */
function dottedToHextets(prefix: string, quad: string): string {
  const [o1, o2, o3, o4] = quad.split(".").map((p) => Number(p));
  const hi = (((o1! << 8) | o2!) >>> 0).toString(16);
  const lo = (((o3! << 8) | o4!) >>> 0).toString(16);
  return `${prefix}${hi}:${lo}`;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a = 256, b] = parts;
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + облачный metadata 169.254.169.254
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved не бывают адресами назначения
  return false;
}

/** Встроенный IPv4 из младших 32 бит (::ffff:x / NAT64 64:ff9b::x / 6to4 2002::x) */
function embeddedIpv4(value: bigint): number[] | null {
  const low = Number(value & 0xffffffffn);
  return [low >>> 24, (low >>> 16) & 255, (low >>> 8) & 255, low & 255];
}

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const value = expandIpv6(ip);
    if (value !== null) {
      if (value <= 1n) return true; // :: и ::1
      const top16 = value >> 112n;
      if (top16 >= 0xfc00n && top16 <= 0xfdffn) return true; // fc00::/7 ULA
      if (top16 >= 0xfe80n && top16 <= 0xfebfn) return true; // fe80::/10 link-local
      if ((top16 & 0xff00n) === 0xff00n) return true; // multicast ff00::/8
      const top32 = value >> 96n;
      if (top32 === 0xffffn && (value & 0xffffffffn) !== 0n) {
        return isPrivateIpv4(embeddedIpv4(value)!); // ::ffff:a.b.c.d (в т.ч. hex-форма)
      }
      if (top32 === 0x64ff9bn) return isPrivateIpv4(embeddedIpv4(value)!); // NAT64 64:ff9b::/96
      if (top16 === 0x2002n) return isPrivateIpv4(embeddedIpv4(value)!); // 6to4 2002::/16
      if (value >> 80n === 0n && (value & 0xffffffffffffffffn) !== 0n) {
        return isPrivateIpv4(embeddedIpv4(value)!); // устаревший IPv4-compatible ::a.b.c.d
      }
      return false;
    }
    return true; // похож на IP, но не разобрался — блокируем
  }
  return isPrivateIpv4(ip.split(".").map(Number));
}

const ALLOWED_PORTS = new Set(["", "80", "443"]);

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
  // Только стандартные порты: иначе URL-ингестия превращается в TCP-сканер
  if (!ALLOWED_PORTS.has(url.port)) throw new Error("PORT_NOT_ALLOWED");
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

interface PinnedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  stream: http.IncomingMessage;
}

/**
 * Запрос к ПРОВЕРЕННОМУ IP (реаудит RA-API-2): fetch() резолвит имя второй раз —
 * атакующий DNS (TTL=0) отвечал публичным адресом на проверку и приватным на
 * подключение (TOCTOU rebinding). Здесь подключение идёт ровно к адресу,
 * который прошёл isPrivateIp; SNI/Host/TLS-валидация — по исходному имени.
 */
function pinnedRequest(url: URL, ip: string, signal: AbortSignal): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const isTls = url.protocol === "https:";
    const req = (isTls ? https : http).request({
      host: ip,
      port: url.port === "" ? (isTls ? 443 : 80) : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { host: url.host, accept: "*/*", "user-agent": "unichat-ingest/1" },
      servername: isTls ? url.hostname : undefined,
      signal,
    }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function fetchWithSsrfGuard(
  rawUrl: string,
  opts: { maxRedirects?: number; maxSizeBytes?: number; timeoutMs?: number } = {},
): Promise<FetchedPage> {
  const { maxRedirects = 3, maxSizeBytes = 5 * 1024 * 1024, timeoutMs = 10_000 } = opts;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    const records = await defaultLookup(url.hostname).catch(() => {
      throw new Error("DNS_RESOLVE_FAILED");
    });
    const ip = records[0]!.address;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await pinnedRequest(url, ip, controller.signal);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location?.[0];
        if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION");
        current = new URL(location, url).toString(); // относительные редиректы
        res.stream.resume(); // сливаем тело редиректа
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP_${res.status}`);
      const declared = Number(res.headers["content-length"] ?? "0");
      if (declared > maxSizeBytes) throw new Error("TOO_LARGE");

      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of res.stream) {
        const buf = chunk as Buffer;
        received += buf.byteLength;
        if (received > maxSizeBytes) {
          res.stream.destroy();
          throw new Error("TOO_LARGE");
        }
        chunks.push(buf);
      }
      const buffer = Buffer.concat(chunks);
      return {
        text: buffer.toString("utf8"),
        contentType: (res.headers["content-type"] as string | undefined) ?? "",
        finalUrl: url.toString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("TOO_MANY_REDIRECTS");
}
