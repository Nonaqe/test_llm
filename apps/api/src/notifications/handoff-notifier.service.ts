/**
 * Напоминания о необработанных handoff (docs/14 §6): никто не принял за N минут
 * → email операторам проекта. Дедупликация — событие handoff.email_notified в
 * append-only events (без изменения схемы). Интервал сканирования — 30 с.
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import type { Pool } from "pg";
import { PG } from "../db/db.module";
import { EventsRepo, ProjectsRepo, SettingsRepo } from "../db/repositories";
import { MAILER, type Mailer } from "./mailer";

const SCAN_INTERVAL_MS = 30_000;
const NOTIFY_AFTER_KEY = "handoff.notify_after_min";
const DEFAULT_NOTIFY_AFTER_MIN = 5;

@Injectable()
export class HandoffNotifierService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  /** Защита от параллельного скана при медленной БД. */
  private running = false;

  constructor(
    @Inject(PG) private readonly db: Pool | null,
    private readonly settings: SettingsRepo,
    private readonly projects: ProjectsRepo,
    private readonly events: EventsRepo,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    if (!this.db) {
      this.logger.warn("DATABASE_URL не настроен — напоминания handoff отключены");
      return;
    }
    this.timer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const minutes = await this.notifyAfterMinutes();
      const { rows } = await this.db!.query<{
        id: string;
        conversation_id: string;
        project_id: string;
      }>(
        `select h.id, h.conversation_id, c.project_id
         from handoffs h join conversations c on c.id = h.conversation_id
         where h.status = 'pending' and h.created_at < now() - make_interval(mins => $1)
         order by h.created_at asc limit 50`,
        [minutes],
      );

      for (const row of rows) {
        const notified = await this.db!.query(
          `select 1 from events
           where action = 'handoff.email_notified' and entity_id = $1 limit 1`,
          [row.id],
        );
        if ((notified.rowCount ?? 0) > 0) continue;

        const members = await this.projects.listMembers(row.project_id);
        const recipients = members.map((m) => m.email);
        await this.mailer.send(
          recipients,
          "Universal Chat: диалог ждёт оператора",
          `Диалог ${row.conversation_id} ожидает принятия более ${minutes} мин.`,
        );
        await this.events.append({
          actorType: "system",
          action: "handoff.email_notified",
          entityType: "handoff",
          entityId: row.id,
          payload: { recipients: recipients.length },
        });
      }
    } catch (err) {
      this.logger.warn({ err: String(err), msg: "handoff notifier scan failed" });
    } finally {
      this.running = false;
    }
  }

  private async notifyAfterMinutes(): Promise<number> {
    try {
      const row = await this.settings.get(NOTIFY_AFTER_KEY);
      const value = Number(row?.value);
      if (Number.isFinite(value) && value > 0 && value <= 1440) return value;
    } catch {
      // настройка не задана/не читается — дефолт
    }
    return DEFAULT_NOTIFY_AFTER_MIN;
  }
}
