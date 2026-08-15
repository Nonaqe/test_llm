import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { SetupController } from "./setup.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { UsersPrincipalLoader } from "./principal-loader";
import {
  MemorySessionStore,
  MemoryThrottleStore,
  SESSION_STORE,
  THROTTLE_STORE,
} from "./stores";

/**
 * Фаза 1: хранилища сессий/throttling — in-memory (интерфейсы Redis-совместимы).
 * Redis-реализация подключается при REDIS_URL в Фазе 4/7 (docs/05 §5).
 */
@Module({
  controllers: [AuthController, SetupController],
  providers: [
    AuthService,
    JwtAuthGuard,
    UsersPrincipalLoader,
    { provide: SESSION_STORE, useClass: MemorySessionStore },
    { provide: THROTTLE_STORE, useClass: MemoryThrottleStore },
  ],
  exports: [JwtAuthGuard, UsersPrincipalLoader, AuthService],
})
export class AuthModule {}
