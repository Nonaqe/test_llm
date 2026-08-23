/**
 * Socket.IO-клиент namespace /widget: авто-reconnect, join комнаты диалога,
 * события message / conversation:state (docs/07 §4).
 */
import { io, type Socket } from "socket.io-client";
import type { ConversationState, WidgetMessageDto } from "@uni-chat/shared";

export interface SocketHandlers {
  onMessage: (message: WidgetMessageDto) => void;
  /** state типизован shared-контрактом (реаудит RA-W-13) */
  onState: (payload: { conversation_id: string; state: ConversationState }) => void;
  onAiToken: (payload: { token: string }) => void;
  /** Есть ли операторы онлайн у проекта (docs/07 §4.1, docs/13 §5) */
  onPresence: (payload: { online: boolean }) => void;
  /** Оператор набирает ответ (TTL на клиенте) */
  onOperatorTyping: () => void;
  onConnect: () => void;
  /** reason из socket.io — «io server disconnect» означает решение сервера */
  onDisconnect: (reason: string) => void;
  /** Ошибка подключения (истёк visitor-JWT, сеть) — элемент решает: re-init */
  onConnectError?: (err: Error) => void;
}

export class WidgetSocket {
  private readonly socket: Socket;

  constructor(baseUrl: string, token: string, handlers: SocketHandlers) {
    this.socket = io(`${baseUrl}/widget`, {
      auth: { token },
      transports: ["websocket", "polling"], // polling-fallback встроен (docs/08 §8)
    });
    this.socket.on("message", handlers.onMessage);
    this.socket.on("conversation:state", handlers.onState);
    this.socket.on("ai_token", handlers.onAiToken);
    this.socket.on("presence:operators", handlers.onPresence);
    this.socket.on("operator:typing", () => handlers.onOperatorTyping());
    this.socket.on("connect", handlers.onConnect);
    this.socket.on("disconnect", (reason: string) => handlers.onDisconnect(reason));
    if (handlers.onConnectError) {
      this.socket.on("connect_error", (err: Error) => handlers.onConnectError!(err));
    }
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  /**
   * Join с таймаутом (аудит IR-059): потерянный ack при обрыве оставлял
   * promise висеть навсегда — кэтч-ап после реконнекта не выполнялся.
   */
  join(conversationId: string, timeoutMs = 3000): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r: { ok: boolean }): void => {
        if (settled) return;
        settled = true;
        resolve(r ?? { ok: false });
      };
      const timer = setTimeout(() => done({ ok: false }), timeoutMs);
      this.socket.emit("widget:join", { conversation_id: conversationId }, (r: { ok: boolean }) => {
        clearTimeout(timer);
        done(r);
      });
    });
  }

  typingStart(conversationId: string): void {
    this.socket.emit("widget:typing:start", { conversation_id: conversationId });
  }

  typingStop(conversationId: string): void {
    this.socket.emit("widget:typing:stop", { conversation_id: conversationId });
  }

  close(): void {
    this.socket.removeAllListeners();
    this.socket.close();
  }
}
