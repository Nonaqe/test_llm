import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { ENV, type Env } from "../config/env";
import { AppError } from "../common/http";
import { verifyVisitorToken, type VisitorPayload } from "./visitor-tokens";

export interface VisitorRequest extends Request {
  visitor?: VisitorPayload;
}

/** Bearer visitor-JWT → req.visitor (docs/15 §1). */
@Injectable()
export class VisitorGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<VisitorRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw AppError.visitorUnauthorized("Токен посетителя отсутствует");

    const payload = verifyVisitorToken(token, this.env.APP_SECRET ?? "");
    if (!payload) throw AppError.visitorUnauthorized();
    req.visitor = payload;
    return true;
  }
}
