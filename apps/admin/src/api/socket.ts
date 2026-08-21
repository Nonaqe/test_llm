/**
 * Socket.IO-клиент namespace /admin (docs/07_API.md §4.2).
 *
 * TBD: подключение выключено флагом ADMIN_SOCKET_ENABLED. Причина: сервер НЕ
 * возвращает access_token в теле ответа POST /auth/login — фактическая форма
 * {data:{user}} (apps/api/src/auth/auth.controller.ts), токен кладётся только в
 * httpOnly-cookie `unichat_access`, недоступную из JS. Для handshake
 * auth:{token} нужен токен в теле ответа login (либо cookie-авторизация
 * handshake на сервере). Когда контракт появится — включить флаг и передать
 * access_token из ответа login в connectAdminSocket().
 */
import { io, type Socket } from "socket.io-client";
import type { AdminClientToServerEvents, AdminServerToClientEvents } from "./types";

/** Заглушка до появления access_token в ответе login (см. комментарий выше). */
export const ADMIN_SOCKET_ENABLED = false;

export type AdminSocket = Socket<AdminServerToClientEvents, AdminClientToServerEvents>;

/**
 * Подключение к /admin. Транспорт websocket, cookie-сессия передаётся вместе с
 * токеном handshake (withCredentials) — как только контракт позволит его получить.
 */
export function connectAdminSocket(accessToken: string): AdminSocket {
  return io("/admin", {
    auth: { token: accessToken },
    transports: ["websocket"],
    withCredentials: true,
  });
}
