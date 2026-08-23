/**
 * Socket.IO gateway, namespace /admin (docs/07 §4.2).
 * Handshake — access JWT из handshake.auth.token ЛИБО из httpOnly-cookie
 * `unichat_access` (браузер не имеет доступа к телу login, но cookie уходит
 * с websocket-handshake при withCredentials); комнаты admin:project:{id}
 * открываются только после проверки UseInbox (docs/15 §2).
 */
import { SubscribeMessage, WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import { Inject, Logger, forwardRef } from "@nestjs/common";
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
import { WidgetGateway } from "./widget.gateway";

export function adminProjectRoom(projectId: string): string {
  return `admin:project:${projectId}`;
}

interface AdminClient extends Socket {
  principal?: Principal;
}

@WebSocketGateway({
  namespace: "/admin",
  // Cookie-аутентификация handshake: CORS-рефлексия произвольного origin с
  // credentials позволила бы чужому сайту открыть сокет с cookie админа.
  // Панель всегда same-origin (prod) либо за прокси dev — CORS не нужен.
  cors: { credentials: true },
})
export class AdminGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AdminGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly usersLoader: UsersPrincipalLoader,
    private readonly presence: PresenceService,
    // Цикл widget↔admin: widget шлёт операторам visitor-typing, здесь — обратный релей
    @Inject(forwardRef(() => WidgetGateway)) private readonly widgets: WidgetGateway,
  ) {}

  async handleConnection(client: AdminClient): Promise<void> {
    // Origin-check (аудит IR-059): cookie-аутентификация делает сокет целью
    // кросс-сайтовых подключений. Панель всегда same-origin (prod) либо
    // localhost в dev — чужой Origin отключается до аутентификации.
    const origin = client.handshake.headers.origin;
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = "";
      }
      const host = client.handshake.headers.host ?? "";
      const devLocalhost =
        this.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(originHost);
      if (originHost !== host && !devLocalhost) {
        this.logger.warn({ origin, host }, "admin ws: чужой Origin отклонён");
        client.disconnect(true);
        return;
      }
    }

    // Готовность principal оформлена обещанием на клиенте: подписки могут прийти
    // раньше завершения загрузки пользователя из БД — они дожидаются его сами.
    client.data.principalReady = (async (): Promise<void> => {
      const authToken = (client.handshake.auth as { token?: string }).token;
      const token = authToken ?? this.tokenFromCookie(client.handshake.headers.cookie);
      // verifyAccessToken не бросает (возвращает null), но обертка страхует DI-путь
      let payload: { sub: string } | null = null;
      try {
        payload = token ? verifyAccessToken(token, this.env.APP_SECRET ?? "") : null;
      } catch {
        payload = null;
      }
      if (!payload) {
        client.disconnect(true);
        return;
      }
      try {
        client.principal = await this.usersLoader.load(payload.sub);
      } catch {
        client.disconnect(true);
      }
    })();
    await client.data.principalReady;
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
    await (client.data?.principalReady as Promise<void> | undefined);
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
    await (client.data?.principalReady as Promise<void> | undefined);
    const principal = client.principal;
    if (!principal || !body?.project_id) return;
    await client.leave(adminProjectRoom(body.project_id));
    this.presence.removeUser(body.project_id, principal.userId);
    this.emitPresence(body.project_id);
  }

  /** Heartbeat присутствия оператора (TTL 60 с — docs/13 §5). */
  @SubscribeMessage("presence:heartbeat")
  async heartbeat(client: AdminClient, body: { project_id: string }): Promise<void> {
    await (client.data?.principalReady as Promise<void> | undefined);
    const principal = client.principal;
    if (!principal || !body?.project_id) return;
    if (!canProject(principal, Permission.UseInbox, { projectId: body.project_id })) return;
    this.presence.heartbeat(body.project_id, principal.userId);
    this.emitPresence(body.project_id);
  }

  /**
   * Релей «оператор набирает…» в комнату диалога /widget (docs/13 §5).
   * Аудит IR-059: событие объявлено в контракте, но не обрабатывалось.
   * Доступ к диалогам оператора уже проверен при admin:subscribe_project;
   * индикатор — ephemeral, персистентности и авторизации по conversation нет.
   */
  @SubscribeMessage("admin:typing")
  async operatorTyping(client: AdminClient, body: { conversation_id: string }): Promise<void> {
    await (client.data?.principalReady as Promise<void> | undefined);
    if (!client.principal || !body?.conversation_id) return;
    this.widgets.emitOperatorTyping(body.conversation_id);
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
