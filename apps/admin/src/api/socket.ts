/**
 * Socket.IO-клиент namespace /admin (docs/07_API.md §4.2).
 *
 * Аутентификация handshake — httpOnly-cookie `unichat_access` (withCredentials):
 * сервер принимает JWT из cookie handshake наравне с auth.token
 * (apps/api/src/realtime/admin.gateway.ts). Токен в теле ответа login не
 * возвращается и не нужен — XSS-безопасность httpOnly не ослабляется.
 */
import { io, type Socket } from "socket.io-client";
import type { AdminClientToServerEvents, AdminServerToClientEvents } from "./types";

/** Realtime включён: cookie-handshake поддержан сервером (Ф5). */
export const ADMIN_SOCKET_ENABLED = true;

export type AdminSocket = Socket<AdminServerToClientEvents, AdminClientToServerEvents>;

/**
 * Подключение к /admin. Транспорт websocket, cookie-сессия уходит вместе с
 * handshake (withCredentials). accessToken опционален — для e2e/скриптов,
 * у которых токен есть в руках.
 */
export function connectAdminSocket(accessToken?: string): AdminSocket {
  return io("/admin", {
    auth: accessToken !== undefined ? { token: accessToken } : {},
    transports: ["websocket"],
    withCredentials: true,
  });
}
