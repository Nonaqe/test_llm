import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  const logger = app.get(Logger);
  logger.log(`chat-api listening on :${env.PORT} (v${env.APP_VERSION}, ${env.NODE_ENV})`);
}

bootstrap().catch((err: unknown) => {
  console.error("fatal: chat-api failed to start", err);
  process.exit(1);
});
