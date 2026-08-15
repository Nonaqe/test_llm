/**
 * JWT-сессии (docs/15 §1): access 15 мин, refresh 7 дней с ротацией.
 * Подпись HMAC-SHA256 на APP_SECRET; чистые функции — тестируются без Nest.
 */
import jwt from "jsonwebtoken";

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 7 * 24 * 60 * 60;

export interface AccessPayload {
  sub: string;
  role: string | null;
  typ: "access";
}

export interface RefreshPayload {
  sub: string;
  jti: string;
  typ: "refresh";
}

export function signAccessToken(
  userId: string,
  installationRole: string | null,
  secret: string,
): string {
  const payload: AccessPayload = { sub: userId, role: installationRole, typ: "access" };
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TTL_S });
}

export function signRefreshToken(userId: string, jti: string, secret: string): string {
  const payload: RefreshPayload = { sub: userId, jti, typ: "refresh" };
  return jwt.sign(payload, secret, { expiresIn: REFRESH_TTL_S });
}

export function verifyAccessToken(token: string, secret: string): AccessPayload | null {
  return verifyTyped<AccessPayload>(token, secret, "access");
}

export function verifyRefreshToken(token: string, secret: string): RefreshPayload | null {
  return verifyTyped<RefreshPayload>(token, secret, "refresh");
}

function verifyTyped<T extends { typ: string }>(
  token: string,
  secret: string,
  expectedTyp: string,
): T | null {
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "string") return null;
    if ((payload as T).typ !== expectedTyp) return null;
    return payload as T;
  } catch {
    return null;
  }
}
