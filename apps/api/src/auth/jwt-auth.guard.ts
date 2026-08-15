import {
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "@uni-chat/core";
import { AppError } from "../common/http";
import { ENV, type Env } from "../config/env";
import { UsersPrincipalLoader } from "./principal-loader";
import { verifyAccessToken } from "./tokens";

export const SESSION_COOKIE = "unichat_access";
export const REFRESH_COOKIE = "unichat_refresh";

export type AuthedRequest = Request & {
  user?: Principal & { email: string };
};

@Injectable()
export class JwtAuthGuard {
  constructor(
    private readonly usersLoader: UsersPrincipalLoader,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const token = cookieToken ?? bearer;
    if (!token) throw AppError.unauthorized();

    const payload = verifyAccessToken(token, this.env.APP_SECRET ?? "");
    if (!payload) throw AppError.unauthorized();

    req.user = await this.usersLoader.load(payload.sub);
    return true;
  }
}

/** @CurrentUser() → Principal & {email} в обработчике. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal & { email: string } => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw AppError.unauthorized();
    return user;
  },
);

export const Auth = () => UseGuards(JwtAuthGuard);
