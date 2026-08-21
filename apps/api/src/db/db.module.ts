import { Global, Module } from "@nestjs/common";
import { Pool, type QueryResult } from "pg";
import { ENV, type Env } from "../config/env";

export const PG = Symbol("PG");

/**
 * Пул подключений PostgreSQL. null, если DATABASE_URL не задан
 * (скелет без БД продолжает отвечать /health — docs/23).
 *
 * query обёрнут: к ошибке прикрепляется текст запроса (queryText) — без него
 * ошибки вида «could not determine data type of parameter $1» невозможно
 * привязать к конкретному SQL в логах/CI.
 */
function attachQueryText(pool: Pool): Pool {
  const original = pool.query.bind(pool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool.query = async (...args: any[]): Promise<QueryResult> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (original as any)(...args);
    } catch (err) {
      const first = args[0] as unknown;
      const text = typeof first === "string" ? first : ((first as { text?: string })?.text ?? "");
      (err as { queryText?: string }).queryText = text.replace(/\s+/g, " ").slice(0, 300);
      throw err;
    }
  };
  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG,
      inject: [ENV],
      useFactory: (env: Env): Pool | null =>
        env.DATABASE_URL
          ? attachQueryText(new Pool({ connectionString: env.DATABASE_URL, max: 10 }))
          : null,
    },
  ],
  exports: [PG],
})
export class DbModule {}
