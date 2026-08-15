import { Global, Module } from "@nestjs/common";
import { ENV, loadEnv } from "./env";

/** Глобальная конфигурация окружения (единственный loadEnv на процесс). */
@Global()
@Module({
  providers: [{ provide: ENV, useValue: loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
