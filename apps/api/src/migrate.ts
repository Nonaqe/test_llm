/**
 * Миграционный раннер (docs/06_DATABASE.md §8):
 * - таблица schema_migrations + advisory lock (один применяющий);
 * - каждый файл migrations/*.sql — в отдельной транзакции с записью;
 * - вызывается `pnpm dev:migrate` (tsx) или `node dist/migrate.js`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { loadEnv } from "./config/env";

const LOCK_NAME = "unichat-schema-migrations";

function migrationsDir(): string {
  // dist/migrate.js → ../migrations ; src/migrate.ts (tsx) → ../migrations — одно и то же место
  return path.resolve(__dirname, "..", "migrations");
}

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl });
  const applied: string[] = [];
  try {
    await pool.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await pool.query("select pg_advisory_lock(hashtext($1))", [LOCK_NAME]);
    try {
      const { rows } = await pool.query("select id from schema_migrations order by id");
      const done = new Set(rows.map((row: { id: string }) => row.id));

      const files = (await readdir(migrationsDir()))
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (const file of files) {
        if (done.has(file)) continue;
        const sql = await readFile(path.join(migrationsDir(), file), "utf8");
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query(sql);
          await client.query("insert into schema_migrations (id) values ($1)", [file]);
          await client.query("commit");
          applied.push(file);
        } catch (err) {
          await client.query("rollback");
          throw new Error(`migration failed: ${file}: ${String(err)}`);
        } finally {
          client.release();
        }
      }
    } finally {
      await pool.query("select pg_advisory_unlock(hashtext($1))", [LOCK_NAME]);
    }
  } finally {
    await pool.end();
  }
  return applied;
}

if (require.main === module) {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL не задан (см. .env.example, docs/17_CONFIGURATION.md)");
    process.exit(1);
  }
  runMigrations(env.DATABASE_URL)
    .then((applied) => {
      console.log(
        applied.length > 0
          ? `применены миграции (${applied.length}): ${applied.join(", ")}`
          : "миграций к применению нет — схема актуальна",
      );
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
