/**
 * Visitor JWT (docs/15 §1): HMAC-SHA256 на APP_SECRET, TTL 24 ч.
 * Полномочия — только «свои диалоги своего сайта» (проверка в сервисах).
 */
import jwt from "jsonwebtoken";

export const VISITOR_TTL_S = 24 * 60 * 60;

export interface VisitorPayload {
  /** visitor_id */
  vid: string;
  /** site_id */
  sid: string;
  /** project_id */
  pid: string;
  typ: "visitor";
}

export function signVisitorToken(
  payload: Omit<VisitorPayload, "typ">,
  secret: string,
): string {
  return jwt.sign({ ...payload, typ: "visitor" }, secret, { expiresIn: VISITOR_TTL_S });
}

export function verifyVisitorToken(token: string, secret: string): VisitorPayload | null {
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "string") return null;
    const p = payload as VisitorPayload;
    if (p.typ !== "visitor" || !p.vid || !p.sid || !p.pid) return null;
    return p;
  } catch {
    return null;
  }
}
