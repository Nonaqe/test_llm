import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { ConfigModule } from "./config/config.module";
import { ReposModule } from "./db/repos.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { SettingsModule } from "./settings/settings.module";
import { UsersModule } from "./users/users.module";
import { loadEnv } from "./config/env";

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    ReposModule,
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
    AuthModule,
    ProjectsModule,
    SettingsModule,
    UsersModule,
  ],
})
export class AppModule {}
