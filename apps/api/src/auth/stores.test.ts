import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySessionStore, MemoryThrottleStore } from "./stores";

describe("MemorySessionStore (docs/15 §1 — ротация/отзыв)", () => {
  it("отозванный jti блокируется", () => {
    const store = new MemorySessionStore();
    expect(store.isRevoked("j1")).toBe(false);
    store.revoke("j1", 60);
    expect(store.isRevoked("j1")).toBe(true);
  });

  it("запись истекает по TTL", () => {
    vi.useFakeTimers();
    const store = new MemorySessionStore();
    store.revoke("j1", 1);
    vi.advanceTimersByTime(1500);
    expect(store.isRevoked("j1")).toBe(false);
    vi.useRealTimers();
  });
});

describe("MemoryThrottleStore: brute-force логина (docs/15 §3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("5 попыток разрешены, 6-я блокируется с retry_after (LOGIN_LOCKED)", () => {
    const store = new MemoryThrottleStore();
    for (let i = 1; i <= 5; i++) {
      expect(store.attempt("ip:mail", 5, 900).allowed).toBe(true);
    }
    const sixth = store.attempt("ip:mail", 5, 900);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterS).toBeGreaterThan(0);
    expect(sixth.retryAfterS).toBeLessThanOrEqual(900);
  });

  it("окно сбрасывается по истечении", () => {
    const store = new MemoryThrottleStore();
    for (let i = 0; i < 5; i++) store.attempt("k", 5, 900);
    expect(store.attempt("k", 5, 900).allowed).toBe(false);
    vi.advanceTimersByTime(901_000);
    expect(store.attempt("k", 5, 900).allowed).toBe(true);
  });

  it("reset снимает блокировку после успешного входа", () => {
    const store = new MemoryThrottleStore();
    for (let i = 0; i < 5; i++) store.attempt("k", 5, 900);
    store.reset("k");
    expect(store.attempt("k", 5, 900).allowed).toBe(true);
  });

  it("ключи изолированы", () => {
    const store = new MemoryThrottleStore();
    for (let i = 0; i < 5; i++) store.attempt("a", 5, 900);
    expect(store.attempt("b", 5, 900).allowed).toBe(true);
    expect(store.attempt("a", 5, 900).allowed).toBe(false);
  });
});
