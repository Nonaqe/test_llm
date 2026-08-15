/**
 * Единая настройка приложения — используется и main.ts, и e2e-тестами,
 * чтобы тесты видели ровно тот же конвейер (префикс, конверт, cookie, CORS).
 */
import type { INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import cookieParser from "cookie-parser";
import { AllExceptionsFilter, DataEnvelopeInterceptor } from "./http";

export function configureApp(app: INestApplication, opts: { developmentOrigin?: boolean } = {}): void {
  // Префиксы зон зашиты в путях контроллеров: /api/v1/*, /widget/v1/*, /health
  // (две независимые публичные зоны — IR-016)
  app.use(cookieParser());

  // Конверт {data}/{error} (docs/07 §1, §5)
  const adapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger), adapterHost));
  app.useGlobalInterceptors(new DataEnvelopeInterceptor());

  // Админка в dev ходит с credentials (docs/23)
  app.enableCors({
    origin: opts.developmentOrigin ? "http://localhost:5173" : true,
    credentials: true,
  });
}
