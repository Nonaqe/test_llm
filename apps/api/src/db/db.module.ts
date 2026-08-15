import { Global, Module } from "@nestjs/common";
import { Pool } from "pg";
import { ENV, type Env } from "../config/env";

export const PG = Symbol("PG");

/**
 * Пул подключений PostgreSQL. null, если DATABASE_URL не задан
 * (скелет без БД продолжает отвечать /health — docs/23).
 */
@Global()
@Module({
  providers: [
    {
      provide: PG,
      inject: [ENV],
      useFactory: (env: Env): Pool | null =>
        env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL, max: 10 }) : null,
    },
  ],
  exports: [PG],
})
export class DbModule {}
