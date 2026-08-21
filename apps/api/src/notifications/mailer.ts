/**
 * Mailer (docs/13 §5, docs/14 §6): уведомления операторам через SMTP заказчика.
 * MVP — консольный транспорт (пишет в лог); SMTP-настройки и реальная отправка —
 * Фаза 7 (отложено, см. журнал D-*). Интерфейс не меняется при подмене транспорта.
 */
import { Injectable, Logger } from "@nestjs/common";

/** DI-токен транспорта отправки (подмена SMTP-транспортом — Фаза 7). */
export const MAILER = Symbol("MAILER");

export interface Mailer {
  send(to: string[], subject: string, text: string): Promise<void>;
}

@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger("ConsoleMailer");

  async send(to: string[], subject: string, text: string): Promise<void> {
    if (to.length === 0) return;
    // Секреты/адреса в логах допустимы: это не ключи; SMTP-транспорт заменит в Ф7
    this.logger.log(`[mail] to=${to.join(", ")} subject="${subject}" body=${text}`);
  }
}
