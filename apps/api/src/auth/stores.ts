/**
 * In-memory хранилища сессий и throttling (docs/15 §1, §3).
 * Интерфейсы сознательно Redis-совместимые: при появлении REDIS_URL
 * подменяются Redis-реализацией без изменения потребителей (Фаза 4/7).
 * Ленивая очистка истёкших записей при каждом обращении.
 */
export interface SessionStore {
  revoke(jti: string, ttlS: number): void;
  isRevoked(jti: string): boolean;
}

export interface ThrottleResult {
  allowed: boolean;
  retryAfterS: number;
}

export interface ThrottleStore {
  attempt(key: string, limit: number, windowS: number): ThrottleResult;
  reset(key: string): void;
}

interface Entry {
  expiresAt: number;
}

export class MemorySessionStore implements SessionStore {
  private readonly revoked = new Map<string, Entry>();

  revoke(jti: string, ttlS: number): void {
    this.revoked.set(jti, { expiresAt: Date.now() + ttlS * 1000 });
  }

  isRevoked(jti: string): boolean {
    const entry = this.revoked.get(jti);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }
}

interface ThrottleEntry {
  count: number;
  resetAt: number;
}

export class MemoryThrottleStore implements ThrottleStore {
  private readonly buckets = new Map<string, ThrottleEntry>();

  attempt(key: string, limit: number, windowS: number): ThrottleResult {
    const now = Date.now();
    const entry = this.buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowS * 1000 });
      return { allowed: true, retryAfterS: 0 };
    }
    entry.count += 1;
    if (entry.count > limit) {
      return { allowed: false, retryAfterS: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    return { allowed: true, retryAfterS: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}

export const SESSION_STORE = Symbol("SESSION_STORE");
export const THROTTLE_STORE = Symbol("THROTTLE_STORE");
