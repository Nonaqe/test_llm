import { describe, expect, it } from "vitest";
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

describe("HealthController (docs/19 §2)", () => {
  it("liveness отвечает ok с версией и uptime", () => {
    const controller = new HealthController(fakeEnv({ APP_VERSION: "1.2.3" }));
    const res = controller.liveness();
    expect(res.status).toBe("ok");
    expect(res.version).toBe("1.2.3");
    expect(res.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it("readiness без DATABASE_URL сообщает not_configured", () => {
    const controller = new HealthController(fakeEnv());
    expect(controller.readiness()).toEqual({
      status: "ok",
      checks: { database: "not_configured" },
    });
  });

  it("readiness с DATABASE_URL — not_checked_yet до Фазы 1", () => {
    const controller = new HealthController(
      fakeEnv({ DATABASE_URL: "postgres://u:p@h:5432/d" }),
    );
    expect(controller.readiness().checks.database).toBe("not_checked_yet");
  });
});
