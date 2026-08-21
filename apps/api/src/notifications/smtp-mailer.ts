/**
 * SMTP-транспорт Mailer (docs/30 §Ф7): настройки smtp.* читаются из settings
 * при КАЖДОЙ отправке (без кэша конфига) — правка в админке действует сразу.
 * smtp.pass хранится зашифрованным (docs/17 §4) и достаётся через getSecret.
 * Если smtp.host пуст — фолбэк к логу (поведение ConsoleMailer), исключений нет:
 * неотправленное уведомление не должно ронять бизнес-операцию (handoff и т.п.).
 */
import { Injectable, Logger } from "@nestjs/common";
import { createTransport } from "nodemailer";
// ВАЖНО: value-импорт, а не import type — Nest читает токен из design:paramtypes
import { SettingsRepo } from "../db/repositories";
import { SettingsService } from "../settings/settings.service";
import type { Mailer } from "./mailer";

@Injectable()
export class SmtpMailer implements Mailer {
  private readonly logger = new Logger("SmtpMailer");

  constructor(
    private readonly settingsRepo: SettingsRepo,
    private readonly settings: SettingsService,
  ) {}

  async send(to: string[], subject: string, text: string): Promise<void> {
    if (to.length === 0) return;

    // Чтение настроек на каждый вызов — сознательно без кэша (ТЗ Ф7)
    const read = async (key: string): Promise<string> => {
      const row = await this.settingsRepo.get(key);
      const value = row?.value;
      if (value == null) return "";
      return typeof value === "string" ? value : String(value);
    };

    const host = (await read("smtp.host")).trim();
    if (!host) {
      // SMTP не настроен — ведём себя как ConsoleMailer
      this.logger.log(`[mail] to=${to.join(", ")} subject="${subject}" body=${text}`);
      return;
    }

    const port = Number(await read("smtp.port")) || 587;
    const user = (await read("smtp.user")).trim();
    const pass = (await this.settings.getSecret("smtp.pass")) ?? "";
    const from = (await read("smtp.from")).trim() || user;

    const transport = createTransport({
      host,
      port,
      secure: port === 465,
      ...(user ? { auth: { user, pass } } : {}),
    });
    try {
      await transport.sendMail({ from, to, subject, text });
    } finally {
      transport.close();
    }
  }
}
