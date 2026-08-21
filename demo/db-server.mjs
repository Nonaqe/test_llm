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

const server = new PGLiteSocketServer({
  db,
  port: PORT,
  host: "127.0.0.1",
  maxConnections: 10,
  debug: process.env.PGLITE_DEBUG === "1",
});
await server.start();
console.log(`[demo-db] PGlite+pgvector on 127.0.0.1:${PORT} (data: demo/.pgdata)`);

process.on("SIGINT", async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
