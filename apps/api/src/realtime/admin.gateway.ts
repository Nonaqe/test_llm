/**
 * Socket.IO gateway, namespace /admin (docs/07 §4.2).
 * Handshake — access JWT из handshake.auth.token ЛИБО из httpOnly-cookie
 * `unichat_access` (браузер не имеет доступа к телу login, но cookie уходит
 * с websocket-handshake при withCredentials); комнаты admin:project:{id}
 * открываются только после проверки UseInbox (docs/15 §2).
 */
import { SubscribeMessage, WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import { Inject, Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import type {
  AdminConversationDto,
  AdminMessageDto,
  AdminServerToClientEvents,
  ConversationState,
  HandoffReason,
} from "@uni-chat/shared";
import { canProject, Permission, type Principal } from "@uni-chat/core";
import { ENV, type Env } from "../config/env";
import { UsersPrincipalLoader } from "../auth/principal-loader";
import { verifyAccessToken } from "../auth/tokens";
import { SESSION_COOKIE } from "../auth/jwt-auth.guard";
import { PresenceService } from "./presence.service";

export function adminProjectRoom(projectId: string): string {
  return `admin:project:${projectId}`;
}

interface AdminClient extends Socket {
  principal?: Principal;
}

@WebSocketGateway({
  namespace: "/admin",
  cors: { origin: true, credentials: true },
})
export class AdminGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AdminGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly usersLoader: UsersPrincipalLoader,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: AdminClient): Promise<void> {
    const authToken = (client.handshake.auth as { token?: string }).token;
    const token = authToken ?? this.tokenFromCookie(client.handshake.headers.cookie);
    const payload = token ? verifyAccessToken(token, this.env.APP_SECRET ?? "") : null;
    if (!payload) {
      client.disconnect(true);
      return;
    }
    try {
      client.principal = await this.usersLoader.load(payload.sub);
    } catch {
      client.disconnect(true);
    }
  }

  /** JWT из cookie-заголовка handshake (SESSION_COOKIE=httpOnly, JS недоступна). */
  private tokenFromCookie(header: string | undefined): string | null {
    if (!header) return null;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === SESSION_COOKIE) {
        return part.slice(eq + 1).trim();
      }
    }
    return null;
  }

  /** TTL-presence истекает сам; явный disconnect ускоряет (MVP — без учёта нескольких сокетов). */
  async handleDisconnect(client: AdminClient): Promise<void> {
    const principal = client.principal;
    const projectId = (client.data as { subscribedProjectId?: string }).subscribedProjectId;
    if (principal && projectId) {
      this.presence.removeUser(projectId, principal.userId);
      this.emitPresence(projectId);
    }
  }

  @SubscribeMessage("admin:subscribe_project")
  async subscribeProject(
    client: AdminClient,
    body: { project_id: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const principal = client.principal;
    if (!principal || !body?.project_id) return { ok: false, error: "bad_request" };
    if (!canProject(principal, Permission.UseInbox, { projectId: body.project_id })) {
      return { ok: false, error: "forbidden_project" };
    }
    // один проект на сокет — повторная подписка переключает комнату
    const previous = (client.data as { subscribedProjectId?: string }).subscribedProjectId;
    if (previous && previous !== body.project_id) {
      await client.leave(adminProjectRoom(previous));
      this.presence.removeUser(previous, principal.userId);
      this.emitPresence(previous);
    }
    (client.data as { subscribedProjectId?: string }).subscribedProjectId = body.project_id;
    await client.join(adminProjectRoom(body.project_id));
    this.presence.heartbeat(body.project_id, principal.userId);
    this.emitPresence(body.project_id);
    return { ok: true };
  }

  @SubscribeMessage("admin:unsubscribe_project")
  async unsubscribeProject(client: AdminClient, body: { project_id: string }): Promise<void> {
    const principal = client.principal;
    if (!principal || !body?.project_id) return;
    await client.leave(adminProjectRoom(body.project_id));
    this.presence.removeUser(body.project_id, principal.userId);
    this.emitPresence(body.project_id);
  }

  /** Heartbeat присутствия оператора (TTL 60 с — docs/13 §5). */
  @SubscribeMessage("presence:heartbeat")
  heartbeat(client: AdminClient, body: { project_id: string }): void {
    const principal = client.principal;
    if (!principal || !body?.project_id) return;
    if (!canProject(principal, Permission.UseInbox, { projectId: body.project_id })) return;
    this.presence.heartbeat(body.project_id, principal.userId);
    this.emitPresence(body.project_id);
  }

  // --- Эмиттеры (вызываются сервисами после персистентности) ---

  emitConversationCreated(projectId: string, conversation: AdminConversationDto): void {
    this.server
      .to(adminProjectRoom(projectId))
      .emit("conversation:created", { conversation });
  }

  emitStateChanged(
    projectId: string,
    conversationId: string,
    state: ConversationState,
  ): void {
    this.server
      .to(adminProjectRoom(projectId))
      .emit("conversation:state_changed", { conversation_id: conversationId, project_id: projectId, state });
  }

  emitMessage(projectId: string, message: AdminMessageDto): void {
    this.server.to(adminProjectRoom(projectId)).emit("message", message);
  }

  emitHandoffCreated(
    projectId: string,
    payload: { conversation_id: string; handoff_id: string; reason: HandoffReason },
  ): void {
    this.server.to(adminProjectRoom(projectId)).emit("handoff:created", {
      ...payload,
      project_id: projectId,
    });
    this.server.to(adminProjectRoom(projectId)).emit("queue:updated", { project_id: projectId });
  }

  emitQueueUpdated(projectId: string): void {
    this.server.to(adminProjectRoom(projectId)).emit("queue:updated", { project_id: projectId });
  }

  emitVisitorTyping(projectId: string, conversationId: string): void {
    this.server
      .to(adminProjectRoom(projectId))
      .emit("visitor:typing", { conversation_id: conversationId, project_id: projectId });
  }

  private emitPresence(projectId: string): void {
    this.server
      .to(adminProjectRoom(projectId))
      .emit("operator:presence", { project_id: projectId, online_count: this.presence.onlineCount(projectId) });
  }
}

export type { AdminServerToClientEvents };
