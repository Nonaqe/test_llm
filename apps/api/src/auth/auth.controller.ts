import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Response } from "express";
import { ENV, type Env } from "../config/env";
import { AuthService } from "./auth.service";
import { Auth, AuthedRequest, CurrentUser, REFRESH_COOKIE, SESSION_COOKIE } from "./jwt-auth.guard";
import { REFRESH_TTL_S, ACCESS_TTL_S } from "./tokens";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** POST /api/v1/auth/login — httpOnly cookie сессии (docs/15 §1). */
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const { email, password } = LoginSchema.parse(body);
    const { user, session } = await this.auth.login(email, password, req.ip ?? null);
    this.setCookies(res, session.accessToken, session.refreshToken);
    return { user };
  }

  /** POST /api/v1/auth/refresh — ротация пары токенов. */
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const { user, session } = await this.auth.refresh(token);
    this.setCookies(res, session.accessToken, session.refreshToken);
    return { user };
  }

  /** POST /api/v1/auth/logout — отзыв refresh и очистка cookie. */
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(token, req.user?.userId, req.ip ?? null);
    res.clearCookie(SESSION_COOKIE, this.cookieBase());
    res.clearCookie(REFRESH_COOKIE, this.cookieBase());
    return { ok: true };
  }

  /** GET /api/v1/auth/me — профиль текущего пользователя. */
  @Get("me")
  @Auth()
  async me(@CurrentUser() user: { userId: string }) {
    return { user: await this.auth.me(user.userId) };
  }

  private cookieBase() {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: this.env.NODE_ENV === "production",
    };
  }

  private setCookies(res: Response, accessToken: string, refreshToken: string): void {
    const base = this.cookieBase();
    // access — на всю приватную зону; refresh — только на /auth (минимизация отправки)
    res.cookie(SESSION_COOKIE, accessToken, { ...base, path: "/api/v1", maxAge: ACCESS_TTL_S * 1000 });
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...base,
      path: "/api/v1/auth",
      maxAge: REFRESH_TTL_S * 1000,
    });
  }
}
