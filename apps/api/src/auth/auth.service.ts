import { Inject, Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { PinoLogger, InjectPinoLogger } from "nestjs-pino";
import { ENV, type Env } from "../config/env";
import { EventsRepo, UsersRepo } from "../db/repositories";
import { AppError } from "../common/http";
import {
  REFRESH_TTL_S,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./tokens";
import { SESSION_STORE, THROTTLE_STORE, type SessionStore, type ThrottleStore } from "./stores";

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_S = 15 * 60;

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  installation_role: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepo,
    private readonly events: EventsRepo,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(THROTTLE_STORE) private readonly throttle: ThrottleStore,
    @Inject(ENV) private readonly env: Env,
    @InjectPinoLogger() private readonly logger: PinoLogger,
  ) {}

  /** Хеширование паролей — argon2id (docs/15 §1). */
  hashPassword(plain: string): Promise<string> {
    return hash(plain);
  }

  async verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return verify(passwordHash, plain);
  }

  async login(email: string, password: string, ip: string | null): Promise<{ user: AuthedUser; session: IssuedSession }> {
    const key = `${ip ?? "no-ip"}:${email.toLowerCase()}`;
    const attempt = this.throttle.attempt(key, LOGIN_LIMIT, LOGIN_WINDOW_S);
    if (!attempt.allowed) {
      await this.events.append({
        actorType: "system",
        action: "auth.login_locked",
        payload: { email },
        ip,
      });
      throw AppError.loginLocked(attempt.retryAfterS);
    }

    const user = await this.users.findByEmail(email);
    const passwordOk = user ? await this.verifyPassword(user.password_hash, password) : false;

    if (!user || !passwordOk || !user.is_active) {
      await this.events.append({
        actorType: "system",
        action: "auth.login_failed",
        payload: { email },
        ip,
      });
      // Единый текст — не раскрываем, существует ли аккаунт (docs/15 §3)
      throw AppError.invalidCredentials();
    }

    this.throttle.reset(key);
    const session = this.issueSession(user.id, user.installation_role);
    await this.events.append({
      actorType: "user",
      actorId: user.id,
      action: "auth.login_success",
      ip,
    });
    return { user: toAuthed(user), session };
  }

  async refresh(refreshToken: string | undefined): Promise<{ user: AuthedUser; session: IssuedSession }> {
    if (!refreshToken) throw AppError.unauthorized("Refresh-токен отсутствует");
    const payload = verifyRefreshToken(refreshToken, this.env.APP_SECRET ?? "");
    if (!payload) throw AppError.unauthorized("Refresh-токен недействителен");
    if (this.sessions.isRevoked(payload.jti)) {
      // Повторное использование отозванного токена — признак кражи: отзываем всё (docs/15 §1)
      throw AppError.unauthorized("Сессия отозвана");
    }

    const user = await this.users.findById(payload.sub);
    if (!user || !user.is_active) throw AppError.unauthorized();

    this.sessions.revoke(payload.jti, REFRESH_TTL_S);
    const session = this.issueSession(user.id, user.installation_role);
    return { user: toAuthed(user), session };
  }

  async logout(refreshToken: string | undefined, userId?: string, ip?: string | null): Promise<void> {
    const payload = refreshToken
      ? verifyRefreshToken(refreshToken, this.env.APP_SECRET ?? "")
      : null;
    if (payload) this.sessions.revoke(payload.jti, REFRESH_TTL_S);
    if (userId) {
      await this.events.append({ actorType: "user", actorId: userId, action: "auth.logout", ip });
    }
  }

  async me(userId: string): Promise<AuthedUser> {
    const user = await this.users.findById(userId);
    if (!user || !user.is_active) throw AppError.unauthorized();
    return toAuthed(user);
  }

  private issueSession(userId: string, installationRole: string | null): IssuedSession {
    const secret = this.env.APP_SECRET ?? "";
    const jti = randomUUID();
    return {
      accessToken: signAccessToken(userId, installationRole, secret),
      refreshToken: signRefreshToken(userId, jti, secret),
    };
  }
}

function toAuthed(user: {
  id: string;
  email: string;
  name: string;
  installation_role: string | null;
}): AuthedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    installation_role: user.installation_role,
  };
}
