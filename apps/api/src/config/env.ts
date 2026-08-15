/**
 * Валидация окружения (zod). Полный список переменных — docs/17_CONFIGURATION.md §2.
 * Фаза 0: БД/Redis опциональны (скелет без них поднимается и отвечает health).
 */
import { z } from "zod";

export const ENV = Symbol("ENV");

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  APP_VERSION: z.string().default("0.1.0"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  APP_SECRET: z.string().min(16).optional(),
  /** Одноразовый токен создания первого владельца (печатает installer — docs/16 §4) */
  SETUP_TOKEN: z.string().min(8).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}

export interface EnvIssue {
  path: string;
  message: string;
}

export function envIssues(source: NodeJS.ProcessEnv): EnvIssue[] {
  const result = EnvSchema.safeParse(source);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
