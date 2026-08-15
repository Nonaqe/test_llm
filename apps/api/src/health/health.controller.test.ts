import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Env } from "../config/env";
import { HealthController } from "./health.controller";

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "development",
    PORT: 3000,
    LOG_LEVEL: "info",
    APP_VERSION: "test-1",
    ...overrides,
  } as Env;
}

function fakePool(mode: "ok" | "error"): Pool {
  return {
    query: async () => {
      if (mode === "error") throw new Error("connection refused");
      return { rows: [] };
    },
  } as unknown as Pool;
}

describe("HealthController (docs/19 §2)", () => {
  it("liveness отвечает ok с версией и uptime", () => {
    const controller = new HealthController(fakeEnv({ APP_VERSION: "1.2.3" }), null);
    const res = controller.liveness();
    expect(res.status).toBe("ok");
    expect(res.version).toBe("1.2.3");
    expect(res.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it("readiness без БД — not_configured", async () => {
    const controller = new HealthController(fakeEnv(), null);
    await expect(controller.readiness()).resolves.toEqual({
      status: "ok",
      checks: { database: "not_configured" },
    });
  });

  it("readiness с живой БД — ok (Фаза 1: реальный пинг)", async () => {
    const controller = new HealthController(fakeEnv(), fakePool("ok"));
    await expect(controller.readiness()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok" },
    });
  });

  it("readiness с недоступной БД — degraded/error", async () => {
    const controller = new HealthController(fakeEnv(), fakePool("error"));
    await expect(controller.readiness()).resolves.toEqual({
      status: "degraded",
      checks: { database: "error" },
    });
  });
});
