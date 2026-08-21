import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { configureApp } from "./common/app-setup";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";
import { registerRedisPubClient } from "./realtime/redis-clients";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  configureApp(app, { developmentOrigin: env.NODE_ENV === "development" });

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
