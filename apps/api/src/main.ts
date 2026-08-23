import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { configureApp } from "./common/app-setup";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";
import { registerRedisPubClient } from "./realtime/redis-clients";

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
    await Promise.all([pub.connect(), sub.connect()]);
    // Для диагностики: «Redis инициализирован в этом процессе» (docs/30 §Ф7)
    registerRedisPubClient(pub);
    app.useWebSocketAdapter(new RedisIoAdapter(app, pub, sub));
  }

  await app.listen(env.PORT);
  const logger = app.get(Logger);
  logger.log(`chat-api listening on :${env.PORT} (v${env.APP_VERSION}, ${env.NODE_ENV})`);
}

bootstrap().catch((err: unknown) => {
  console.error("fatal: chat-api failed to start", err);
  process.exit(1);
});
