import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { MAILER } from "./mailer";
import { HandoffNotifierService } from "./handoff-notifier.service";
import { SmtpMailer } from "./smtp-mailer";

/**
 * Уведомления (docs/30 §Ф7): MAILER = SmtpMailer — настройки smtp.* из settings
 * при каждой отправке; пустой smtp.host → фолбэк к логу. ConsoleMailer остаётся
 * как эталон фолбэк-поведения и для подмены в тестах.
 */
@Module({
  imports: [SettingsModule], // SettingsService (расшифровка smtp.pass)
  providers: [{ provide: MAILER, useClass: SmtpMailer }, HandoffNotifierService],
  exports: [MAILER],
})
export class NotificationsModule {}
