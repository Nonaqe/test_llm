/**
 * Socket.IO gateway, namespace /widget (docs/07 §4.1).
 * Handshake — visitor JWT (handshake.auth.token); комната conversation:{id}
 * присоединяется после проверки владения диалогом.
 */
import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from "@nestjs/websockets";
import { Inject, Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import type { WidgetMessageDto } from "@uni-chat/shared";
import { ConversationState } from "@uni-chat/shared";
import { ENV, type Env } from "../config/env";
import { verifyVisitorToken, type VisitorPayload } from "../widget/visitor-tokens";
import { ConversationsRepo } from "../widget/widget.repos";

export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

interface WidgetClient extends Socket {
  visitor?: VisitorPayload;
}

@WebSocketGateway({
  namespace: "/widget",
  cors: { origin: true, credentials: true },
})
export class WidgetGateway implements OnGatewayConnection {
  private readonly logger = new Logger(WidgetGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly conversations: ConversationsRepo,
  ) {}

  async handleConnection(client: WidgetClient): Promise<void> {
    const token = (client.handshake.auth as { token?: string }).token;
    const payload = token ? verifyVisitorToken(token, this.env.APP_SECRET ?? "") : null;
    if (!payload) {
      client.disconnect(true);
      return;
    }
    client.visitor = payload;
  }

  @SubscribeMessage("widget:join")
  async handleJoin(
    client: WidgetClient,
    body: { conversation_id: string },
  ): Promise<{ ok: boolean; error?: string }> {
    if (!client.visitor || !body?.conversation_id) {
      return { ok: false, error: "bad_request" };
    }
    const conversation = await this.conversations.findById(body.conversation_id);
    if (!conversation || conversation.visitor_id !== client.visitor.vid) {
      return { ok: false, error: "not_found" }; // не раскрываем существование (docs/15)
    }
    await client.join(conversationRoom(conversation.id));
    return { ok: true };
  }

  /** Typing-события принимаются; релей операторам — Фаза 4 (namespace /admin). */
  @SubscribeMessage("widget:typing:start")
  handleTypingStart(): void {}

  @SubscribeMessage("widget:typing:stop")
  handleTypingStop(): void {}

  emitMessage(conversationId: string, message: WidgetMessageDto): void {
    this.server.to(conversationRoom(conversationId)).emit("message", message);
  }

  emitState(conversationId: string, state: ConversationState): void {
    this.server
      .to(conversationRoom(conversationId))
      .emit("conversation:state", { conversation_id: conversationId, state });
  }
}
