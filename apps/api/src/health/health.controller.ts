import { Controller, Get, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import type { HealthResponse, ReadinessResponse } from "@uni-chat/shared";
import { ENV, type Env } from "../config/env";
import { PG } from "../db/db.module";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PG) private readonly db: Pool | null,
  ) {}

  @Get()
  liveness(): HealthResponse {
    return {
      status: "ok",
      version: this.env.APP_VERSION,
      uptime_s: Math.round(process.uptime()),
    };
  }

  /** Readiness: пинг БД, если она настроена (docs/19 §2). */
  @Get("ready")
  async readiness(): Promise<ReadinessResponse> {
    if (!this.db) {
      return { status: "ok", checks: { database: "not_configured" } };
    }
    try {
      await this.db.query("select 1");
      return { status: "ok", checks: { database: "ok" } };
    } catch {
      return { status: "degraded", checks: { database: "error" } };
    }
  }
}
