import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BACKUP_RUNNER, BackupService, spawnRunner } from "./backup.service";
import { DiagnosticsController } from "./diagnostics.controller";

/**
 * Бэкапы и диагностика (docs/30 §Ф7). spawnRunner — реальный раннер внешних
 * процессов; в юнит-тестах подменяется фейком через токен BACKUP_RUNNER.
 */
@Module({
  imports: [AuthModule, NotificationsModule], // guard + MAILER для алертов
  controllers: [DiagnosticsController],
  providers: [BackupService, { provide: BACKUP_RUNNER, useValue: spawnRunner }],
  exports: [BackupService],
})
export class BackupsModule {}
