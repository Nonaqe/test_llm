import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import * as path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { configureApp } from "./common/app-setup";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";
import { registerRedisPubClient } from "./realtime/redis-clients";

/**
 * Раздача SPA-админки из образа (реаудит RA-I-2): раньше прод-стек физически
 * не отдавал /admin — install.sh отправлял на /wizard, а сервил его только
 * dev-Vite. Регистрируется ПОСЛЕ app.init(): статика и fallback идут в конце
 * цепочки express и не затеняют API-маршруты.
 */
function serveAdmin(app: NestExpressApplication, adminDir: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const express = require("express") as typeof import("express");
  app.use("/admin", express.static(adminDir, { index: "index.html" }));
  app.use("/admin", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.sendFile(path.join(adminDir, "index.html"));
  });
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // req.ip из X-Forwarded-For за обратным прокси (docs/17 §2): без этого у всех
  // клиентов за Caddy один IP — вырождаются throttle-ключи и аудит-события
  if (env.TRUST_PROXY !== undefined) {
    app.set("trust proxy", env.TRUST_PROXY);
  }

  configureApp(app, { developmentOrigin: env.NODE_ENV === "development" });

  // Статика админки регистрируется ДО init(): middleware из app.use попадает
  // в стек express раньше роутеров Nest и не получает 404 от них. Маунт строго
  // на префикс /admin — API (/api,/widget,/health,/socket.io) не пересекается.
  if (env.ADMIN_STATIC_DIR) {
    serveAdmin(app, env.ADMIN_STATIC_DIR);
  }

  // Миграции применяются при старте api (docs/16, docs/20 §3): раннер
  // идемпотентен (schema_migrations + advisory lock) — повторный старт и
  // параллельный worker безопасны; чистая установка получает схему сама.
  if (env.DATABASE_URL) {
    const { runMigrations } = await import("./migrate");
    const applied = await runMigrations(env.DATABASE_URL);
    app
      .get(Logger)
      .log(applied.length ? `migrations applied: ${applied.join(", ")}` : "migrations: up to date");
  }

  // Multi-instance fanout при нескольких api-инстансах (docs/03 §7).
  // Без REDIS_URL работает дефолтный in-memory adapter (один инстанс — MVP-профиль).
  if (env.REDIS_URL) {
    const { createClient } = await import("redis");
    const pub = createClient({ url: env.REDIS_URL });
    const sub = pub.duplicate();
    // Обработчики error обязательны (реаудит RA-API-10): необработанное событие
    // node-redis валит процесс — сбой Redis не должен убивать api
    const logger0 = app.get(Logger);
    pub.on("error", (err) => logger0.error({ err }, "redis pub error"));
    sub.on("error", (err) => logger0.error({ err }, "redis sub error"));
    await Promise.all([pub.connect(), sub.connect()]);
    // Для диагностики: «Redis инициализирован в этом процессе» (docs/30 §Ф7)
    registerRedisPubClient(pub);
    app.useWebSocketAdapter(new RedisIoAdapter(app, pub, sub));
  }

  await app.listen(env.PORT);

  const logger = app.get(Logger);
  if (env.ADMIN_STATIC_DIR) {
    logger.log(`admin SPA served from ${env.ADMIN_STATIC_DIR} at /admin`);
  }
  logger.log(`chat-api listening on :${env.PORT} (v${env.APP_VERSION}, ${env.NODE_ENV})`);
}

bootstrap().catch((err: unknown) => {
  console.error("fatal: chat-api failed to start", err);
  process.exit(1);
});
