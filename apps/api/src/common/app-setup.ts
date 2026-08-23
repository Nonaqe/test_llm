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

  // Заголовки безопасности (docs/15 §3). HSTS ставит Caddy на TLS-терминации.
  app.use((_req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // Конверт {data}/{error} (docs/07 §1, §5)
  const adapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger), adapterHost));
  app.useGlobalInterceptors(new DataEnvelopeInterceptor());

  // CORS по зонам (docs/15 §1):
  // - /widget/v1 — встраивается на сайты клиентов: отражаем любой Origin,
  //   БЕЗ credentials (visitor-JWT в Authorization, куки не участвуют);
  // - /api/v1 — админка: в проде same-origin (кросс-домен не нужен,
  //   отражать произвольный Origin с credentials нельзя), в dev — Vite.
  app.use("/widget/v1", (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  // CSRF origin-check для мутирующих запросов /api/v1 (docs/15 §3; аудит IR-059:
  // double-submit из docs не реализован — компенсирующее управление):
  // сессия админки — ambient httpOnly-cookie, поэтому браузерный кросс-сайтовый
  // запрос с cookie обязан иметь Origin своего сайта. Widget-зона не затронута —
  // там Bearer-токен, CSRF неприменим.
  app.use("/api/v1", (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const origin = req.headers.origin;
    if (mutating && origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = "";
      }
      if (originHost !== (req.headers.host ?? "")) {
        res.status(403).json({
          error: { code: "CSRF_ORIGIN_MISMATCH", message: "Запрос отклонён: Origin не совпадает с сервером" },
        });
        return;
      }
    }
    next();
  });
  if (opts.developmentOrigin) {
    app.use("/api/v1", (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
      const origin = req.headers.origin;
      if (origin === "http://localhost:5173") {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }
}
