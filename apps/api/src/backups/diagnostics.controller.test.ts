import { describe, expect, it, vi } from "vitest";
import { canInstallation, Permission, type Principal } from "@uni-chat/core";
import { InstallationRole, ProjectRole } from "@uni-chat/shared";
import type { Pool } from "pg";
import type { Env } from "../config/env";
import { AppError } from "../common/http";
import type { SettingsRepo } from "../db/repositories";
import { BackupService, type BackupMarker } from "./backup.service";
import { DiagnosticsController } from "./diagnostics.controller";

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    LOG_LEVEL: "info",
    APP_VERSION: "9.9.9",
    BACKUP_DIR: "./backups",
    UPLOAD_DIR: "./uploads",
    BACKUP_AT: "03:00",
    ...overrides,
  } as Env;
}

const owner: Principal = {
  userId: "u1",
  installationRole: InstallationRole.Owner,
  memberships: [],
};
const operator: Principal = {
  userId: "u2",
  installationRole: null,
  memberships: [{ projectId: "p1", projectRole: ProjectRole.Operator }],
};

function fakePool(mode: "ok" | "error"): Pool {
  return {
    query: async () => {
      if (mode === "error") throw new Error("connection refused");
      return { rows: [] };
    },
  } as unknown as Pool;
}

function fakeSettingsRepo(value: unknown): SettingsRepo {
  return {
    get: async () => ({ value, is_secret: false }),
  } as unknown as SettingsRepo;
}

function fakeBackups(marker: BackupMarker | null = null): BackupService {
  return {
    lastMarker: async () => marker,
    run: vi.fn(async () => {
      throw new Error("pg_dump crashed");
    }),
  } as unknown as BackupService;
}

describe("DiagnosticsController (docs/30 §Ф7)", () => {
  it("RBAC: оператор без ManageInstallation получает forbidden", async () => {
    const controller = new DiagnosticsController(fakeEnv(), null, fakeSettingsRepo(null), fakeBackups());
    expect(canInstallation(operator, Permission.ManageInstallation)).toBe(false);
    await expect(controller.status(operator)).rejects.toThrow(AppError);
    await expect(controller.runBackup(operator)).rejects.toThrow(AppError);
  });

  it("без БД и Redis — not_configured по обоим сервисам", async () => {
    const controller = new DiagnosticsController(fakeEnv(), null, fakeSettingsRepo(null), fakeBackups());
    const res = await controller.status(owner);
    expect(res).toMatchObject({
      version: "9.9.9",
      node: process.version,
      db: "not_configured",
      redis: "not_configured",
      provider_kind: null,
      last_backup: null,
    });
    expect(res.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it("живая БД → ok; недоступная → error", async () => {
    const ok = new DiagnosticsController(fakeEnv(), fakePool("ok"), fakeSettingsRepo(null), fakeBackups());
    await expect(ok.status(owner)).resolves.toMatchObject({ db: "ok" });

    const bad = new DiagnosticsController(fakeEnv(), fakePool("error"), fakeSettingsRepo(null), fakeBackups());
    await expect(bad.status(owner)).resolves.toMatchObject({ db: "error" });
  });

  it("provider_kind читается из settings ai_provider.kind", async () => {
    const controller = new DiagnosticsController(
      fakeEnv(),
      null,
      fakeSettingsRepo("openai_compatible"),
      fakeBackups(),
    );
    await expect(controller.status(owner)).resolves.toMatchObject({
      provider_kind: "openai_compatible",
    });
  });

  it("last_backup пробрасывается из BackupService.lastMarker", async () => {
    const marker: BackupMarker = {
      at_iso: "2024-01-15T03:00:00.000Z",
      dump_file: "/backups/unichat-20240115-060000.dump",
      uploads_file: null,
      size_bytes: 123,
      ok: true,
    };
    const controller = new DiagnosticsController(
      fakeEnv(),
      null,
      fakeSettingsRepo(null),
      fakeBackups(marker),
    );
    await expect(controller.status(owner)).resolves.toMatchObject({ last_backup: marker });
  });

  it("ошибка бэкапа → AppError INTERNAL с message исходной ошибки", async () => {
    const controller = new DiagnosticsController(fakeEnv(), null, fakeSettingsRepo(null), fakeBackups());
    const err = await controller.runBackup(owner).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    const appErr = err as AppError;
    expect(appErr.code).toBe("INTERNAL");
    expect(appErr.getStatus()).toBe(500);
    expect(appErr.message).toBe("pg_dump crashed");
  });
});
