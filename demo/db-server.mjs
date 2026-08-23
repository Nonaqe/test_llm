/**
 * Демо-БД без Docker: встроенный Postgres (PGlite/WASM) с расширением pgvector,
 * выставленный наружу по wire-протоколу — node-pg из API подключается как к обычному PG.
 * Данные лежат в demo/.pgdata (переживают перезапуск). Порт 54329.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.PGLITE_PORT ?? 54329);

const db = await PGlite.create({
  dataDir: fileURLToPath(new URL("./.pgdata", import.meta.url)),
  extensions: { vector },
});

// Периодический чекпоинт (реаудит RA-I-6): без него WAL не сбрасывается и
// unclean restart теряет данные. API чекпоинта зависит от версии PGlite —
// вызываем опционально и глотаем ошибки, чтобы таймер не ронял сервер.
setInterval(() => {
  try {
    if (typeof db.checkpoint === "function") {
      Promise.resolve(db.checkpoint()).catch(() => undefined);
    }
  } catch {
    /* нет API в этой версии */
  }
}, 30_000).unref();

const server = new PGLiteSocketServer({
  db,
  port: PORT,
  host: "127.0.0.1",
  maxConnections: 32,
  debug: process.env.PGLITE_DEBUG === "1",
});
await server.start();
console.log(`[demo-db] PGlite+pgvector on 127.0.0.1:${PORT} (data: demo/.pgdata)`);

// SIGTERM/SIGHUP = дефолт kill/стоп менеджера процессов: закрываем БД чисто
async function shutdown() {
  await server.stop().catch(() => undefined);
  try {
    await db.checkpoint();
    await db.close();
  } catch {
    /* уже мертв */
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
