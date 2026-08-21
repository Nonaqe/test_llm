/**
 * Воркер-процесс — тот же образ, другой entrypoint (ADR-010).
 * Каркас: heartbeat + graceful shutdown. Очереди BullMQ — Фаза 3 (docs/05 §5).
 * Ф7 (docs/30 §Ф7): ночное расписание бэкапов — тикер каждые 10 мин, запуск если
 * локальное время >= BACKUP_AT и за сегодня бэкапа ещё нет (маркер at_iso).
 * В main.ts расписание не подключается: бэкапы — работа воркера.
 */
import "reflect-metadata"; // декорированные классы сервисов читают метаданные при загрузке
import { Pool } from "pg";
import { BackupService, parseBackupAt } from "./backups/backup.service";
import { loadEnv } from "./config/env";
import { SettingsRepo } from "./db/repositories";
import { SmtpMailer } from "./notifications/smtp-mailer";
import { SettingsService } from "./settings/settings.service";

const TICK_MS = 30_000;
const BACKUP_CHECK_INTERVAL_MS = 10 * 60_000;

let running = true;
let ticks = 0;

function log(msg: string, extra: Record<string, unknown> = {}): void {
  // Пока без pino-обвязки: единый JSON-формат, читаемый docker logs (docs/19 §1)
  console.log(JSON.stringify({ level: "info", time: Date.now(), msg, ...extra }));
}

function tick(): void {
  if (!running) return;
  ticks += 1;
  log("worker heartbeat", { tick: ticks });
}

// Ручная сборка зависимостей бэкапа: воркер живёт вне Nest-DI (ADR-010),
// сервисы переиспользуются напрямую. Пул минимальный — только чтение настроек.
const env = loadEnv();
const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL, max: 2 }) : null;
const settingsRepo = new SettingsRepo(pool);
const settings = new SettingsService(settingsRepo, env);
const mailer = new SmtpMailer(settingsRepo, settings);
const backups = new BackupService(env, mailer);

/**
 * Ночной бэкап: маркер с at_iso сегодняшней локальной даты означает «запуск уже
 * был» — включая неудачный (повторных попыток до завтра нет, алерт ушёл; ручной
 * перезапуск — POST /api/v1/diagnostics/backup).
 */
async function maybeRunBackup(): Promise<void> {
  if (!env.DATABASE_URL || !pool) return; // скелет без БД — бэкапить нечего
  try {
    if (await backups.hasBackupToday()) return;
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    if (minutesNow < parseBackupAt(env.BACKUP_AT)) return;
    log("backup schedule triggered", { backup_at: env.BACKUP_AT });
    const marker = await backups.run();
    log("backup finished", {
      ok: marker.ok,
      dump_file: marker.dump_file,
      size_bytes: marker.size_bytes,
    });
  } catch (err) {
    // Ошибка уже записана в маркер и отправлена алертом — здесь только журнал
    log("backup failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

const timer = setInterval(tick, TICK_MS);
const backupTimer = setInterval(() => void maybeRunBackup(), BACKUP_CHECK_INTERVAL_MS);
backupTimer.unref(); // процесс держит heartbeat-таймер, а не тикер бэкапов
void maybeRunBackup(); // догоняющий запуск после рестарта воркера

function shutdown(signal: string): void {
  if (!running) return;
  running = false;
  clearInterval(timer);
  clearInterval(backupTimer);
  void pool?.end();
  log("worker stopped", { signal, ticks });
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log("worker started", { tick_ms: TICK_MS, backup_at: env.BACKUP_AT });
