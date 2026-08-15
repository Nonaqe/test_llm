import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Response } from "express";
import { ENV, type Env } from "../config/env";
import { AppError } from "../common/http";
import { AuthService } from "./auth.service";
import { AuthedRequest, REFRESH_COOKIE, SESSION_COOKIE } from "./jwt-auth.guard";
import { ACCESS_TTL_S, REFRESH_TTL_S } from "./tokens";
import { EventsRepo, UsersRepo } from "../db/repositories";

const SetupSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().max(200).default(""),
});

/**
 * POST /api/v1/setup — создание первого владельца по одноразовому SETUP-токену
 * (токен печатает installer; docs/16 §4, docs/22 §1).
 */
@Controller("setup")
export class SetupController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersRepo,
    private readonly events: EventsRepo,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post()
  @HttpCode(201)
  async setup(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const input = SetupSchema.parse(body);

    if ((await this.users.count()) > 0) {
      throw AppError.conflict("SETUP_ALREADY_DONE", "Первоначальная настройка уже выполнена");
    }
    if (!this.env.SETUP_TOKEN || input.token !== this.env.SETUP_TOKEN) {
      throw new AppError("SETUP_TOKEN_INVALID", "Неверный токен первоначальной настройки", 403);
    }

    const passwordHash = await this.auth.hashPassword(input.password);
    const user = await this.users.insert({
      email: input.email,
      passwordHash,
      name: input.name,
      installationRole: "owner",
    });
    await this.events.append({
      actorType: "system",
      action: "setup.completed",
      entityType: "user",
      entityId: user.id,
      ip: req.ip ?? null,
    });

    // Автоматический вход после настройки
    const { session } = await this.auth.login(input.email, input.password, req.ip ?? null);
    const base = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: this.env.NODE_ENV === "production",
    };
    res.cookie(SESSION_COOKIE, session.accessToken, { ...base, path: "/api/v1", maxAge: ACCESS_TTL_S * 1000 });
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...base,
      path: "/api/v1/auth",
      maxAge: REFRESH_TTL_S * 1000,
    });

    return { user: { id: user.id, email: user.email, name: user.name, installation_role: user.installation_role } };
  }
}
