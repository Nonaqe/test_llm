import { Module } from "@nestjs/common";
import { ConsoleMailer, MAILER } from "./mailer";
import { HandoffNotifierService } from "./handoff-notifier.service";

/** Уведомления: консольный mailer (SMTP — Фаза 7) + напоминания handoff. */
@Module({
  providers: [{ provide: MAILER, useClass: ConsoleMailer }, HandoffNotifierService],
  exports: [MAILER],
})
export class NotificationsModule {}
