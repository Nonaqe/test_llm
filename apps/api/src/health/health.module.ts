import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { ENV, loadEnv } from "../config/env";

@Module({
  controllers: [HealthController],
  providers: [{ provide: ENV, useValue: loadEnv() }],
})
export class HealthModule {}
