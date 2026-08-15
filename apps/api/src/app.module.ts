import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { HealthModule } from "./health/health.module";
import { loadEnv } from "./config/env";

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        // Секреты не пишутся в логи (docs/19_LOGGING_MONITORING.md §1)
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
          censor: "[redacted]",
        },
        ...(env.NODE_ENV === "development"
          ? { transport: { target: "pino-pretty" } }
          : {}),
      },
    }),
    HealthModule,
  ],
})
export class AppModule {}
