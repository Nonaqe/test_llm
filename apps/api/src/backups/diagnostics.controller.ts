/**
 * Диагностика установки (docs/30 §Ф7): версии, статусы сервисов, последний бэкап.
 * Только ManageInstallation — в диагностике видны внутренности установки.
 */
import { Controller, Get, Inject, Post } from "@nestjs/common";
import type { Pool } from "pg";
import { canInstallation, Permission, type Principal } from "@uni-chat/core";
import { AppError } from "../common/http";
import { Auth, CurrentUser } from "../auth/jwt-auth.guard";
import { ENV, type Env } from "../config/env";
import { PG } from "../db/db.module";
import { SettingsRepo } from "../db/repositories";
import { getRedisPubClient } from "../realtime/redis-clients";
import { BackupService, type BackupMarker } from "./backup.service";

type ServiceStatus = "ok" | "error" | "not_configured";

export interface DiagnosticsResponse {
  version: string;
  node: string;
  uptime_s: number;
  db: ServiceStatus;
  redis: ServiceStatus;
  provider_kind: string | null;
  last_backup: BackupMarker | null;
}

@Controller("api/v1/diagnostics")
export class DiagnosticsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PG) private readonly db: Pool | null,
    private readonly settingsRepo: SettingsRepo,
    private readonly backups: BackupService,
  ) {}

  @Get()
  @Auth()
  async status(@CurrentUser() user: Principal): Promise<DiagnosticsResponse> {
    this.requireAdmin(user);
    return {
      version: this.env.APP_VERSION,
      node: process.version,
      uptime_s: Math.round(process.uptime()),
      db: await this.dbStatus(),
      redis: await this.redisStatus(),
      provider_kind: await this.providerKind(),
      last_backup: await this.backups.lastMarker(),
    };
  }

  /** Ручной запуск бэкапа; ошибка → 500 INTERNAL с message (ТЗ Ф7). */
  @Post("backup")
  @Auth()
  async runBackup(@CurrentUser() user: Principal): Promise<BackupMarker> {
    this.requireAdmin(user);
    try {
      return await this.backups.run();
    } catch (err) {
      throw new AppError(
        "INTERNAL",
        err instanceof Error ? err.message : String(err),
        500,
      );
    }
  }

  private requireAdmin(user: Principal): void {
    if (!canInstallation(user, Permission.ManageInstallation)) {
      throw AppError.forbidden("Диагностика доступна только администраторам");
    }
  }

  private async dbStatus(): Promise<ServiceStatus> {
    if (!this.db) return "not_configured";
    try {
      await this.db.query("select 1");
      return "ok";
    } catch {
      return "error";
    }
  }

  /** Redis инициализирован в этом api-процессе (main.ts при REDIS_URL) → ping. */
  private async redisStatus(): Promise<ServiceStatus> {
    const client = getRedisPubClient();
    if (!client) return "not_configured";
    try {
      await client.ping();
      return "ok";
    } catch {
      return "error";
    }
  }

  private async providerKind(): Promise<string | null> {
    try {
      const value = (await this.settingsRepo.get("ai_provider.kind"))?.value;
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch {
      return null; // без БД провайдер нечитаем — диагностика не должна падать
    }
  }
}
