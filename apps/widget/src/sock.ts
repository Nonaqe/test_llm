/**
 * Socket.IO-клиент namespace /widget: авто-reconnect, join комнаты диалога,
 * события message / conversation:state (docs/07 §4).
 */
import { io, type Socket } from "socket.io-client";
import type { WidgetMessageDto } from "@uni-chat/shared";

export interface SocketHandlers {
  onMessage: (message: WidgetMessageDto) => void;
  onState: (payload: { conversation_id: string; state: string }) => void;
  onAiToken: (payload: { token: string }) => void;
  onConnect: () => void;
  onDisconnect: () => void;
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
    this.socket.on("connect", handlers.onConnect);
    this.socket.on("disconnect", handlers.onDisconnect);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  join(conversationId: string): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
      this.socket.emit("widget:join", { conversation_id: conversationId }, (r: { ok: boolean }) =>
        resolve(r ?? { ok: false }),
      );
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
