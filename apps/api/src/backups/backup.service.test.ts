import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env";
import type { Mailer } from "../notifications/mailer";
import {
  BackupService,
  localDateIso,
  parseBackupAt,
  parseDatabaseUrl,
  type BackupMarker,
  type CommandRunner,
} from "./backup.service";

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    LOG_LEVEL: "info",
    APP_VERSION: "test",
    BACKUP_DIR: "./backups",
    UPLOAD_DIR: "./uploads",
    BACKUP_AT: "03:00",
    ...overrides,
  } as Env;
}

function fakeMailer() {
  return { send: vi.fn(async () => undefined) } as unknown as Mailer & {
    send: ReturnType<typeof vi.fn>;
  };
}

/** Фейковый раннер: создаёт файлы-артефакты как сделали бы pg_dump/tar. */
function fakeRunner(failCommands: string[] = []) {
  const calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> = [];
  const runner: CommandRunner = async (command, args, opts) => {
    calls.push({ command, args, env: opts?.env });
    if (failCommands.includes(command)) throw new Error(`${command} crashed`);
    if (command === "pg_dump") {
      const fileArg = args.find((a) => a.startsWith("--file="));
      await writeFile(fileArg!.slice("--file=".length), "DUMPDATA");
    }
    if (command === "tar") {
      const out = args[args.indexOf("-czf") + 1];
      await writeFile(out!, "TARGZ");
    }
  };
  return { calls, runner };
}

const tempDirs: string[] = [];
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(nodePath.join(tmpdir(), `unichat-backup-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseDatabaseUrl (docs/30 §Ф7)", () => {
  it("разбирает стандартный postgres:// URL", () => {
    expect(parseDatabaseUrl("postgres://user:pass@db.local:5433/chat")).toEqual({
      host: "db.local",
      port: "5433",
      username: "user",
      password: "pass",
      database: "chat",
    });
  });

  it("декодирует URL-encoded пароль и подставляет порт по умолчанию", () => {
    const parsed = parseDatabaseUrl("postgresql://u:p%40ss%2Fword@localhost/mydb");
    expect(parsed.password).toBe("p@ss/word");
    expect(parsed.port).toBe("5432");
    expect(parsed.database).toBe("mydb");
  });

  it("URL без имени базы — ошибка", () => {
    expect(() => parseDatabaseUrl("postgres://u:p@localhost:5432/")).toThrow(
      /без имени базы/i,
    );
  });
});

describe("parseBackupAt", () => {
  it("HH:MM → минуты от полуночи", () => {
    expect(parseBackupAt("03:00")).toBe(180);
    expect(parseBackupAt("23:59")).toBe(23 * 60 + 59);
  });

  it("некорректное/пустое значение → дефолт 03:00", () => {
    expect(parseBackupAt(undefined)).toBe(180);
    expect(parseBackupAt("99:00")).toBe(180);
    expect(parseBackupAt("зло")).toBe(180);
  });
});

describe("BackupService.run — маркер ok/fail (docs/30 §Ф7)", () => {
  it("успешный запуск: pg_dump с параметрами из DATABASE_URL, маркер ok:true", async () => {
    const backupDir = await makeTempDir("ok");
    const { calls, runner } = fakeRunner();
    const service = new BackupService(
      fakeEnv({
        DATABASE_URL: "postgres://adm:s3cret@db.local:5433/chat",
        BACKUP_DIR: backupDir,
      }),
      fakeMailer(),
      runner,
    );

    const marker = await service.run();

    expect(marker.ok).toBe(true);
    expect(marker.size_bytes).toBe("DUMPDATA".length);
    expect(marker.uploads_file).toBeNull();
    expect(marker.dump_file).toMatch(/unichat-\d{8}-\d{6}\.dump$/);
    expect(existsSync(marker.dump_file)).toBe(true);

    const dumpCall = calls.find((c) => c.command === "pg_dump")!;
    expect(dumpCall.args).toContain("--format=custom");
    expect(dumpCall.args).toContain(`--file=${marker.dump_file}`);
    expect(dumpCall.args).toContain("--host=db.local");
    expect(dumpCall.args).toContain("--port=5433");
    expect(dumpCall.args).toContain("--username=adm");
    expect(dumpCall.args.at(-1)).toBe("chat"); // имя базы позиционным аргументом
    expect(dumpCall.env?.PGPASSWORD).toBe("s3cret"); // пароль только через env

    // Маркер last-backup.json записан на диск и совпадает с ответом
    const onDisk = JSON.parse(
      await readFile(nodePath.join(backupDir, "last-backup.json"), "utf8"),
    ) as BackupMarker;
    expect(onDisk).toEqual(marker);
    expect(await service.lastMarker()).toEqual(marker);
  });

  it("uploads существует → tar.gz рядом с дампом и ссылка в маркере", async () => {
    const backupDir = await makeTempDir("uploads-b");
    const uploadsDir = await makeTempDir("uploads-u");
    await writeFile(nodePath.join(uploadsDir, "file.txt"), "x");
    const { calls, runner } = fakeRunner();
    const service = new BackupService(
      fakeEnv({ DATABASE_URL: "postgres://u:p@localhost/db", BACKUP_DIR: backupDir, UPLOAD_DIR: uploadsDir }),
      fakeMailer(),
      runner,
    );

    const marker = await service.run();

    expect(marker.uploads_file).not.toBeNull();
    expect(marker.uploads_file).toMatch(/unichat-\d{8}-\d{6}-uploads\.tar\.gz$/);
    expect(existsSync(marker.uploads_file!)).toBe(true);
    expect(marker.size_bytes).toBe("DUMPDATA".length + "TARGZ".length);

    const tarCall = calls.find((c) => c.command === "tar")!;
    expect(tarCall.args[0]).toBe("-czf");
    expect(tarCall.args).toContain("-C");
    // Архив собирается из родителя uploads, чтобы внутрь попала сама папка
    expect(tarCall.args[tarCall.args.indexOf("-C") + 1]).toBe(nodePath.dirname(uploadsDir));
    expect(tarCall.args.at(-1)).toBe(nodePath.basename(uploadsDir));
  });

  it("ошибка pg_dump → маркер ok:false с error, алерт на ALERT_EMAIL, run() бросает", async () => {
    const backupDir = await makeTempDir("fail");
    const mailer = fakeMailer();
    const { runner } = fakeRunner(["pg_dump"]);
    const service = new BackupService(
      fakeEnv({
        DATABASE_URL: "postgres://u:p@localhost/db",
        BACKUP_DIR: backupDir,
        ALERT_EMAIL: "admin@example.com",
      }),
      mailer,
      runner,
    );

    await expect(service.run()).rejects.toThrow("pg_dump crashed");

    const onDisk = JSON.parse(
      await readFile(nodePath.join(backupDir, "last-backup.json"), "utf8"),
    ) as BackupMarker;
    expect(onDisk.ok).toBe(false);
    if (!onDisk.ok) expect(onDisk.error).toBe("pg_dump crashed");
    expect(mailer.send).toHaveBeenCalledWith(
      ["admin@example.com"],
      expect.stringContaining("бэкап"),
      expect.stringContaining("pg_dump crashed"),
    );
  });

  it("ошибка без ALERT_EMAIL — алерт не отправляется", async () => {
    const backupDir = await makeTempDir("fail2");
    const mailer = fakeMailer();
    const { runner } = fakeRunner(["pg_dump"]);
    const service = new BackupService(
      fakeEnv({ DATABASE_URL: "postgres://u:p@localhost/db", BACKUP_DIR: backupDir }),
      mailer,
      runner,
    );

    await expect(service.run()).rejects.toThrow();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("нет DATABASE_URL → отказ до вызова внешних процессов", async () => {
    const backupDir = await makeTempDir("nodb");
    const { calls, runner } = fakeRunner();
    const service = new BackupService(
      fakeEnv({ DATABASE_URL: undefined, BACKUP_DIR: backupDir }),
      fakeMailer(),
      runner,
    );
    await expect(service.run()).rejects.toThrow(/DATABASE_URL не настроен/);
    expect(calls).toHaveLength(0);
    // fail-маркер всё равно пишется
    const onDisk = JSON.parse(
      await readFile(nodePath.join(backupDir, "last-backup.json"), "utf8"),
    ) as BackupMarker;
    expect(onDisk.ok).toBe(false);
  });

  it("hasBackupToday: маркер сегодня → true, вчера → false, нет маркера → false", async () => {
    const backupDir = await makeTempDir("today");
    const service = new BackupService(
      fakeEnv({ DATABASE_URL: "postgres://u:p@localhost/db", BACKUP_DIR: backupDir }),
      fakeMailer(),
      fakeRunner().runner,
    );

    expect(await service.hasBackupToday()).toBe(false);

    const write = (at_iso: string): Promise<void> =>
      writeFile(
        nodePath.join(backupDir, "last-backup.json"),
        JSON.stringify({ at_iso, ok: false, error: "x" }),
        "utf8",
      );

    await write(new Date().toISOString());
    expect(await service.hasBackupToday()).toBe(true);

    const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
    await write(yesterday.toISOString());
    expect(await service.hasBackupToday()).toBe(false);

    // Битый маркер трактуется как «бэкапа не было»
    await writeFile(nodePath.join(backupDir, "last-backup.json"), "{битый json", "utf8");
    expect(await service.lastMarker()).toBeNull();
    expect(await service.hasBackupToday()).toBe(false);
  });

  it("localDateIso считает локальную дату", () => {
    const d = new Date(2024, 0, 9, 23, 59); // локальная дата, не UTC
    expect(localDateIso(d)).toBe("2024-01-09");
  });
});

describe("BackupService.pruneOldDumps — retention 7/4 (docs/30 §Ф7)", () => {
  /** Фейковые дампы с заданными mtime (fs.utimes). */
  async function seedDumps(dir: string, files: Array<{ name: string; mtime: Date }>): Promise<void> {
    for (const f of files) {
      const full = nodePath.join(dir, f.name);
      await writeFile(full, "x");
      await utimes(full, f.mtime, f.mtime);
    }
  }

  const wd = (day: number, hour = 3): Date => new Date(2024, 0, day, hour); // январь 2024
  // 2024-01-07/14/21/28 — воскресенья; 08–12, 15–19 — будни

  it("оставляет 7 последних по mtime, более старые удаляет", async () => {
    const dir = await makeTempDir("ret1");
    await seedDumps(dir, [
      { name: "unichat-20240108-030000.dump", mtime: wd(8) },
      { name: "unichat-20240109-030000.dump", mtime: wd(9) },
      { name: "unichat-20240110-030000.dump", mtime: wd(10) },
      { name: "unichat-20240111-030000.dump", mtime: wd(11) },
      { name: "unichat-20240112-030000.dump", mtime: wd(12) },
      { name: "unichat-20240115-030000.dump", mtime: wd(15) },
      { name: "unichat-20240116-030000.dump", mtime: wd(16) },
      { name: "unichat-20240117-030000.dump", mtime: wd(17) },
      { name: "unichat-20240118-030000.dump", mtime: wd(18) },
    ]);

    const service = new BackupService(fakeEnv(), fakeMailer(), fakeRunner().runner);
    await service.pruneOldDumps(dir);

    const left = (await readdir(dir)).sort();
    expect(left).toHaveLength(7);
    expect(left).not.toContain("unichat-20240108-030000.dump");
    expect(left).not.toContain("unichat-20240109-030000.dump");
    expect(left).toContain("unichat-20240118-030000.dump");
  });

  it("воскресные дампы сохраняются сверх 7 последних (до 4 якорей)", async () => {
    const dir = await makeTempDir("ret2");
    await seedDumps(dir, [
      // 7 свежих будних
      { name: "unichat-20240115-030000.dump", mtime: wd(15) },
      { name: "unichat-20240116-030000.dump", mtime: wd(16) },
      { name: "unichat-20240117-030000.dump", mtime: wd(17) },
      { name: "unichat-20240118-030000.dump", mtime: wd(18) },
      { name: "unichat-20240119-030000.dump", mtime: wd(19) },
      { name: "unichat-20240122-030000.dump", mtime: wd(22) },
      { name: "unichat-20240123-030000.dump", mtime: wd(23) },
      // старые воскресные якоря
      { name: "unichat-20240107-030000.dump", mtime: wd(7) },
      { name: "unichat-20240114-030000.dump", mtime: wd(14) },
    ]);

    const service = new BackupService(fakeEnv(), fakeMailer(), fakeRunner().runner);
    await service.pruneOldDumps(dir);

    const left = (await readdir(dir)).sort();
    expect(left).toHaveLength(9); // 7 последних + 2 воскресных
    expect(left).toContain("unichat-20240107-030000.dump");
    expect(left).toContain("unichat-20240114-030000.dump");
  });

  it("воскресных якорей не больше 4 — самый старый удаляется", async () => {
    const dir = await makeTempDir("ret3");
    await seedDumps(dir, [
      // 7 свежих будних
      { name: "unichat-20240122-030000.dump", mtime: wd(22) },
      { name: "unichat-20240123-030000.dump", mtime: wd(23) },
      { name: "unichat-20240124-030000.dump", mtime: wd(24) },
      { name: "unichat-20240125-030000.dump", mtime: wd(25) },
      { name: "unichat-20240126-030000.dump", mtime: wd(26) },
      { name: "unichat-20240129-030000.dump", mtime: wd(29) },
      { name: "unichat-20240130-030000.dump", mtime: wd(30) },
      // 5 воскресений — хранятся только 4 самых свежих
      { name: "unichat-20240107-030000.dump", mtime: wd(7) },
      { name: "unichat-20240114-030000.dump", mtime: wd(14) },
      { name: "unichat-20240121-030000.dump", mtime: wd(21) },
      { name: "unichat-20240128-030000.dump", mtime: wd(28) },
      { name: "unichat-20240204-030000.dump", mtime: new Date(2024, 1, 4, 3) },
    ]);

    const service = new BackupService(fakeEnv(), fakeMailer(), fakeRunner().runner);
    await service.pruneOldDumps(dir);

    const left = (await readdir(dir)).sort();
    // 12 дампов: 7 последних по mtime (в их числе вс 28.01 и вс 04.02)
    // + якоря вс 21.01 и вс 14.01; удаляются будни 22–23.01 и самое старое вс 07.01
    expect(left).toHaveLength(9);
    expect(left).not.toContain("unichat-20240107-030000.dump"); // 5-е воскресенье
    expect(left).not.toContain("unichat-20240122-030000.dump");
    expect(left).not.toContain("unichat-20240123-030000.dump");
    expect(left).toContain("unichat-20240204-030000.dump");
    expect(left).toContain("unichat-20240114-030000.dump");
  });

  it("чужие файлы в каталоге бэкапов не трогаются", async () => {
    const dir = await makeTempDir("ret4");
    await mkdir(nodePath.join(dir, "subdir"), { recursive: true });
    await seedDumps(dir, [{ name: "keep-me.txt", mtime: wd(1) }]);
    await seedDumps(dir, [{ name: "unichat-20240108-030000.dump", mtime: wd(8) }]);

    const service = new BackupService(fakeEnv(), fakeMailer(), fakeRunner().runner);
    await service.pruneOldDumps(dir);

    expect(existsSync(nodePath.join(dir, "keep-me.txt"))).toBe(true);
    expect(existsSync(nodePath.join(dir, "subdir"))).toBe(true);
  });
});
