/**
 * Сервис бэкапов (docs/30 §Ф7): pg_dump --format=custom + uploads → tar.gz,
 * маркер last-backup.json, retention 7/4, email-алерт при ошибке.
 * Запуск: вручную (POST /api/v1/diagnostics/backup) или по расписанию воркера
 * (тикер 10 мин, окно BACKUP_AT — см. worker.ts; в main.ts не подключается).
 *
 * Внешние процессы (pg_dump/tar) вызываются через инжектируемый CommandRunner:
 * юнит-тесты подставляют фейк и не требуют утилит на машине.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";
import type { Env } from "../config/env";
import { ENV } from "../config/env";
import { MAILER, type Mailer } from "../notifications/mailer";

export const BACKUP_RUNNER = Symbol("BACKUP_RUNNER");

/** Инжектируемая обёртка над spawn (stdio: ignore); reject при коде != 0. */
export type CommandRunner = (
  command: string,
  args: string[],
  options?: { env?: Record<string, string> },
) => Promise<void>;

export function spawnRunner(
  command: string,
  args: string[],
  options?: { env?: Record<string, string> },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      env: { ...process.env, ...options?.env },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} завершился с кодом ${code ?? "<signal>"}`));
    });
  });
}

export interface ParsedDatabaseUrl {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
}

/** postgres://user:p%40ss@host:5433/dbname → части для pg_dump (пароль декодируется). */
export function parseDatabaseUrl(raw: string): ParsedDatabaseUrl {
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!database) throw new Error("DATABASE_URL без имени базы");
  return {
    host: url.hostname,
    port: url.port || "5432",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

export interface BackupOkMarker {
  at_iso: string;
  dump_file: string;
  uploads_file: string | null;
  size_bytes: number;
  ok: true;
}

export interface BackupFailMarker {
  at_iso: string;
  ok: false;
  error: string;
}

export type BackupMarker = BackupOkMarker | BackupFailMarker;

const MARKER_FILE = "last-backup.json";
const DUMP_PATTERN = /^unichat-\d{8}-\d{6}\.dump$/;

/**
 * Retention 7/4 (docs/30 §Ф7): после успешного бэкапа остаются 7 последних .dump
 * по mtime ПЛЮС до 4 самых свежих воскресных (недельные «якоря» — точка
 * восстановления на начало недели). Файл из обеих категорий хранится один раз;
 * удаляется только то, что не входит ни в одну. Удаляем исключительно файлы с
 * именем unichat-*.dump в каталоге бэкапов — чужие файлы не трогаем.
 */
const KEEP_RECENT_DUMPS = 7;
const KEEP_SUNDAY_DUMPS = 4;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Локальный штамп времени для имён файлов: YYYYMMDD-HHMMSS. */
export function localStamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

/** Локальная дата YYYY-MM-DD (сравнение «бэкап уже был сегодня»). */
export function localDateIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "03:00" → минуты от полуночи; пусто/некорректно → дефолт 03:00. */
export function parseBackupAt(value: string | undefined): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "");
  if (!m) return 3 * 60;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return 3 * 60;
  return h * 60 + min;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger("BackupService");
  /** Защита от параллельного запуска (расписание + ручной POST). */
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(BACKUP_RUNNER) private readonly runCommand: CommandRunner = spawnRunner,
  ) {}

  /**
   * Полный цикл бэкапа. При ошибке пишет маркер {ok:false, error}, шлёт алерт на
   * ALERT_EMAIL (если задан) и пробрасывает исключение дальше (контроллер → 500).
   */
  async run(): Promise<BackupOkMarker> {
    if (this.running) throw new Error("Бэкап уже выполняется");
    this.running = true;
    try {
      return await this.doRun();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`backup failed: ${error}`);
      try {
        await this.writeMarker({ at_iso: new Date().toISOString(), ok: false, error });
      } catch (markerErr) {
        this.logger.error(
          `failed to write fail-marker: ${markerErr instanceof Error ? markerErr.message : String(markerErr)}`,
        );
      }
      await this.alertFailure(error);
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** Последний маркер (ok/fail) или null, если бэкапов ещё не было / файл битый. */
  async lastMarker(): Promise<BackupMarker | null> {
    try {
      const raw = await readFile(this.markerPath(), "utf8");
      const parsed = JSON.parse(raw) as BackupMarker;
      return typeof parsed?.ok === "boolean" ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Был ли запуск (успешный или нет) уже сегодня по локальной дате at_iso. */
  async hasBackupToday(now: Date = new Date()): Promise<boolean> {
    const marker = await this.lastMarker();
    if (!marker) return false;
    const at = new Date(marker.at_iso);
    if (Number.isNaN(at.getTime())) return false;
    return localDateIso(at) === localDateIso(now);
  }

  /** Retention 7/4; вынесен публично для юнит-тестов на временной папке. */
  async pruneOldDumps(dir: string): Promise<void> {
    const dumps: Array<{ file: string; mtime: Date }> = [];
    for (const name of await readdir(dir)) {
      if (!DUMP_PATTERN.test(name)) continue;
      const file = nodePath.join(dir, name);
      dumps.push({ file, mtime: (await stat(file)).mtime });
    }
    const byMtimeDesc = [...dumps].sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const keep = new Set(byMtimeDesc.slice(0, KEEP_RECENT_DUMPS).map((d) => d.file));
    // Воскресные якоря: до KEEP_SUNDAY_DUMPS самых свежих с mtime в воскресенье
    for (const d of byMtimeDesc.filter((x) => x.mtime.getDay() === 0).slice(0, KEEP_SUNDAY_DUMPS)) {
      keep.add(d.file);
    }
    for (const d of dumps) {
      if (!keep.has(d.file)) await unlink(d.file).catch(() => undefined);
    }
  }

  private async doRun(): Promise<BackupOkMarker> {
    const dbUrl = this.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL не настроен — бэкап БД невозможен");
    const db = parseDatabaseUrl(dbUrl);

    const dir = nodePath.resolve(this.env.BACKUP_DIR);
    await mkdir(dir, { recursive: true });

    const stamp = localStamp(new Date());
    const dumpFile = nodePath.join(dir, `unichat-${stamp}.dump`);
    // Пароль — только через env (PGPASSWORD), имя базы — позиционным аргументом
    await this.runCommand(
      "pg_dump",
      [
        "--format=custom",
        `--file=${dumpFile}`,
        `--host=${db.host}`,
        `--port=${db.port}`,
        `--username=${db.username}`,
        db.database,
      ],
      { env: { PGPASSWORD: db.password } },
    );

    let uploadsFile: string | null = null;
    const uploadsDir = nodePath.resolve(this.env.UPLOAD_DIR);
    if (existsSync(uploadsDir)) {
      uploadsFile = nodePath.join(dir, `unichat-${stamp}-uploads.tar.gz`);
      // -C <родитель> + basename: в архиве лежит папка uploads целиком
      await this.runCommand("tar", [
        "-czf",
        uploadsFile,
        "-C",
        nodePath.dirname(uploadsDir),
        nodePath.basename(uploadsDir),
      ]);
    }

    // size_bytes — суммарный размер артефактов запуска (дамп + архив uploads)
    const size =
      (await stat(dumpFile)).size + (uploadsFile ? (await stat(uploadsFile)).size : 0);

    const marker: BackupOkMarker = {
      at_iso: new Date().toISOString(),
      dump_file: dumpFile,
      uploads_file: uploadsFile,
      size_bytes: size,
      ok: true,
    };
    await this.writeMarker(marker);
    await this.pruneOldDumps(dir);
    return marker;
  }

  private async alertFailure(error: string): Promise<void> {
    const to = this.env.ALERT_EMAIL;
    if (!to) return;
    try {
      await this.mailer.send(
        [to],
        "Universal Chat: ошибка бэкапа",
        `Ночной бэкап завершился ошибкой: ${error}`,
      );
    } catch (err) {
      // Алерт не должен маскировать исходную ошибку бэкапа
      this.logger.warn(`alert email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private markerPath(): string {
    return nodePath.join(nodePath.resolve(this.env.BACKUP_DIR), MARKER_FILE);
  }

  private async writeMarker(marker: BackupMarker): Promise<void> {
    const dir = nodePath.resolve(this.env.BACKUP_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(nodePath.join(dir, MARKER_FILE), JSON.stringify(marker, null, 2), "utf8");
  }
}
