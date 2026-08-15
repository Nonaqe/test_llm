/**
 * Единый конверт ответов: успех {data}, ошибка {error:{code,message,details}} (docs/07_API.md §1, §5).
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Inject,
  Injectable,
  ExecutionContext,
  CallHandler,
  NestInterceptor,
} from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { HttpAdapterHost } from "@nestjs/core";
import { Observable, map } from "rxjs";
import { ZodError } from "zod";

export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }

  static unauthorized(message = "Требуется авторизация"): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
  }
  static invalidCredentials(): AppError {
    return new AppError("AUTH_INVALID_CREDENTIALS", "Неверный email или пароль", 401);
  }
  static loginLocked(retryAfterS: number): AppError {
    return new AppError("LOGIN_LOCKED", "Слишком много попыток входа. Попробуйте позже", 429, {
      retry_after_s: retryAfterS,
    });
  }
  static rateLimited(retryAfterS: number): AppError {
    return new AppError("RATE_LIMITED", "Слишком много запросов. Подождите немного", 429, {
      retry_after_s: retryAfterS,
    });
  }
  static invalidOrigin(): AppError {
    return new AppError("INVALID_ORIGIN", "Домен не разрешён для этого чата", 403);
  }
  static visitorUnauthorized(message = "Недействительный токен посетителя"): AppError {
    return new AppError("VISITOR_TOKEN_INVALID", message, 401);
  }
  static forbiddenProject(): AppError {
    return new AppError("FORBIDDEN_PROJECT", "Нет доступа к этому проекту", 403);
  }
  static forbidden(message = "Недостаточно прав"): AppError {
    return new AppError("FORBIDDEN", message, 403);
  }
  static notFound(entity = "Объект"): AppError {
    return new AppError("NOT_FOUND", `${entity} не найден`, 404);
  }
  static conflict(code: string, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(code, message, 409, details);
  }
  static validation(details: Record<string, unknown>): AppError {
    return new AppError("VALIDATION_FAILED", "Некорректные данные запроса", 422, details);
  }
  static internal(): AppError {
    return new AppError("INTERNAL", "Внутренняя ошибка сервера", 500);
  }
}

const STATUS_TO_CODE: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
};

@Injectable()
export class DataEnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => ({ data: body ?? null })));
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(Logger) private readonly logger: Logger,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status: (code: number) => void; json: (b: unknown) => void }>();

    let status = 500;
    let body: { error: { code: string; message: string; details?: Record<string, unknown> } };

    if (exception instanceof ZodError) {
      status = 422;
      body = {
        error: {
          code: "VALIDATION_FAILED",
          message: "Некорректные данные запроса",
          details: { issues: exception.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        },
      };
    } else if (exception instanceof AppError) {
      status = exception.getStatus();
      const payload = exception.getResponse() as { code: string; message: string; details?: Record<string, unknown> };
      body = { error: { code: payload.code, message: payload.message, details: payload.details } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === "string"
          ? payload
          : ((payload as { message?: string | string[] }).message ?? "Ошибка запроса");
      body = {
        error: {
          code: STATUS_TO_CODE[status] ?? "HTTP_ERROR",
          message: Array.isArray(message) ? message.join("; ") : String(message),
        },
      };
    } else {
      body = { error: { code: "INTERNAL", message: "Внутренняя ошибка сервера" } };
      this.logger.error({ err: exception, msg: "unhandled exception" });
    }

    res.status(status);
    res.json(body);
  }
}
