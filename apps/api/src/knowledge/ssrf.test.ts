import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isPrivateIp } from "./ssrf";

describe("isPrivateIp (docs/15 §3)", () => {
  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "127.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "::1",
    "::",
    "fc00::1",
    "fd12::1",
    "fe80::1",
    "fea9::1",
    "::ffff:10.0.0.1", // v4-mapped dotted
    "::ffff:7f00:1", // v4-mapped HEX-форма (IR-058: строковый префикс её пропускал)
    "64:ff9b::a00:1", // NAT64 со встроенным 10.0.0.1
    "2002:a00:1::", // 6to4 со встроенным 10.0.0.1
    "::a00:1", // устаревший IPv4-compatible
    "ff02::1", // multicast
  ])("приватный адрес %s блокируется", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "публичный адрес %s разрешается",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );

  it("кривая строка трактуется как приватная (fail-closed)", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  const lookupPublic = async () => [{ address: "93.184.216.34" }];
  const lookupPrivate = async () => [{ address: "10.0.0.5" }];
  const lookupMixed = async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }];

  it("публичный http(s) проходит", async () => {
    await expect(
      assertPublicHttpUrl("https://example.com/page", lookupPublic),
    ).resolves.toBeInstanceOf(URL);
  });

  it.each(["ftp://example.com", "file:///etc/passwd", "data:text/html,x"])(
    "не-http схема %s отклоняется",
    async (url) => {
      await expect(assertPublicHttpUrl(url, lookupPublic)).rejects.toThrow("ONLY_HTTPS_HTTP");
    },
  );

  it("кривой URL отклоняется", async () => {
    await expect(assertPublicHttpUrl("http://", lookupPublic)).rejects.toThrow("INVALID_URL");
  });

  it.each(["http://example.com:8080/", "https://example.com:22/", "http://example.com:6379/"])(
    "нестандартный порт %s отклоняется (анти-скан)",
    async (url) => {
      await expect(assertPublicHttpUrl(url, lookupPublic)).rejects.toThrow("PORT_NOT_ALLOWED");
    },
  );

  it("резолв в приватный адрес отклоняется", async () => {
    await expect(assertPublicHttpUrl("http://internal.local", lookupPrivate)).rejects.toThrow(
      "PRIVATE_ADDRESS_BLOCKED",
    );
  });

  it("смешанный резолв (часть адресов приватные) отклоняется", async () => {
    await expect(assertPublicHttpUrl("http://dual.local", lookupMixed)).rejects.toThrow(
      "PRIVATE_ADDRESS_BLOCKED",
    );
  });

  it("DNS-ошибка отклоняется", async () => {
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(assertPublicHttpUrl("http://nope.invalid", failing)).rejects.toThrow(
      "DNS_RESOLVE_FAILED",
    );
  });
});
