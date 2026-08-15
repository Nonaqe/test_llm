/**
 * Health endpoints (docs/19_LOGGING_MONITORING.md §2).
 * /health — liveness (без зависимостей); /health/ready — readiness (БД-пинг подключается в Фазе 1).
 */
import { Controller, Get, Inject } from "@nestjs/common";
import type { HealthResponse, ReadinessResponse } from "@uni-chat/shared";
import { ENV, type Env } from "../config/env";

@Controller("health")
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  liveness(): HealthResponse {
    return {
      status: "ok",
      version: this.env.APP_VERSION,
      uptime_s: Math.round(process.uptime()),
    };
  }

  @Get("ready")
  readiness(): ReadinessResponse {
    return {
      status: "ok",
      checks: {
        database: this.env.DATABASE_URL ? "not_checked_yet" : "not_configured",
      },
    };
  }
}
