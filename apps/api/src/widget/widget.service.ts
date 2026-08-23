/**
 * Публичная зона виджета (docs/07 §2): init → visitor JWT, диалоги, сообщения
 * с атомарным seq, кэтч-ап after_seq, явный handoff, офлайн-заявка leave-email.
 * AI-ход — Conversation Engine; в WAITING_OPERATOR/OPERATOR_ACTIVE движок молчит
 * (docs/13 «Частые ошибки»), сообщение посетителя в RESOLVED/CLOSED переоткрывает.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import {
  ConversationState,
  HandoffReason,
  HandoffRequestedBy,
  MessageRole,
  type WidgetConfig,
  type WidgetConversationDto,
  type WidgetInitResponse,
  type WidgetMessageDto,
} from "@uni-chat/shared";
import { ENV, type Env } from "../config/env";
import { AppError } from "../common/http";
import { EventsRepo } from "../db/repositories";
import { THROTTLE_STORE, type ThrottleStore } from "../auth/stores";
import { WidgetGateway } from "../realtime/widget.gateway";
import { AdminGateway } from "../realtime/admin.gateway";
import { ConversationEngineService } from "../conversations/conversation-engine.service";
import { HandoffService } from "../conversations/handoff.service";
import { matchOrigin } from "./origin";
import { signVisitorToken } from "./visitor-tokens";
import { toMessageDto } from "./message-dto";

export { toMessageDto };
import {
  ConversationsRepo,
  HandoffsRepo,
  SitesRepo,
  VisitorsRepo,
  type ConversationRow,
} from "./widget.repos";

const LIMITS = {
  initPerMinute: 30,
  conversationsPerHour: 5,
  messagesPerMinute: 10,
  emailPerMinute: 5,
} as const;

export const InitSchema = z.object({
  key: z.string().min(8).max(200),
  anon_id: z.string().min(8).max(100),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export const SendMessageSchema = z.object({
  text: z.string().min(1).max(4000),
});

export const LeaveEmailSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(200).optional(),
});

@Injectable()
export class WidgetService {
  /** Идемпотентность POST сообщений: key → сообщение (in-memory; Redis — Фаза 7). */
  /**
   * Idempotency-кэш повторов POST сообщений. Ключ скоупится по visitor+диалогу:
   * голый заголовок позволял чужому посетителю получить ЧУЖОЕ сообщение из кэша
   * (межарендовая утечка, аудит IR-059). Записи с истёкшим TTL вытесняются.
   */
  private readonly idempotency = new Map<
    string,
    { message: import("./widget.repos").WidgetMessageRow; expiresAt: number }
  >();
  private static IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
  private static IDEMPOTENCY_MAX_ENTRIES = 5000;
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    private readonly sites: SitesRepo,
    private readonly visitors: VisitorsRepo,
    private readonly conversations: ConversationsRepo,
    private readonly handoffsRepo: HandoffsRepo,
    private readonly events: EventsRepo,
    private readonly gateway: WidgetGateway,
    private readonly admin: AdminGateway,
    private readonly engine: ConversationEngineService,
    private readonly handoffs: HandoffService,
    @Inject(THROTTLE_STORE) private readonly throttle: ThrottleStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async init(
    input: z.infer<typeof InitSchema>,
    headerOrigin: string | undefined,
    ip: string | null,
  ): Promise<WidgetInitResponse> {
    const attempt = this.throttle.attempt(`w-init:${ip ?? "no-ip"}`, LIMITS.initPerMinute, 60);
    if (!attempt.allowed) throw AppError.rateLimited(attempt.retryAfterS);

    const site = await this.sites.findByKey(input.key);
    if (!site || !site.is_active) throw AppError.notFound("Сайт");

    // Валидируется ЗАГОЛОВОК Origin (тело подделывается) — IR-017
    if (!matchOrigin(site.allowed_origins, headerOrigin)) {
      await this.events.append({
        actorType: "system",
        action: "widget.init_invalid_origin",
        payload: { site_id: site.id, origin: headerOrigin ?? null },
        ip,
      });
      throw AppError.invalidOrigin();
    }

    const visitorId = await this.visitors.upsert(
      site.project_id,
      input.anon_id,
      input.attributes ?? {},
    );

    const conversation = await this.conversations.findOpenForVisitor(visitorId);
    return {
      visitor_token: signVisitorToken(
        { vid: visitorId, sid: site.id, pid: site.project_id },
        this.env.APP_SECRET ?? "",
      ),
      widget: this.widgetConfig(site.widget_config),
      conversation: conversation ? toConversationDto(conversation) : null,
    };
  }

  async createConversation(
    visitor: { vid: string; sid: string; pid: string },
  ): Promise<WidgetConversationDto> {
    const attempt = this.throttle.attempt(
      `w-conv:${visitor.vid}`,
      LIMITS.conversationsPerHour,
      3600,
    );
    if (!attempt.allowed) throw AppError.rateLimited(attempt.retryAfterS);

    const conversation = await this.conversations.create({
      projectId: visitor.pid,
      siteId: visitor.sid,
      visitorId: visitor.vid,
    });
    await this.events.append({
      actorType: "visitor",
      actorId: visitor.vid,
      action: "conversation.created",
      entityType: "conversation",
      entityId: conversation.id,
    });
    // Панель оператора: новый диалог в очереди (docs/07 §4.2)
    this.admin.emitConversationCreated(visitor.pid, {
      ...emptyAdminCard(conversation),
      created_at: new Date().toISOString(),
    });
    this.admin.emitQueueUpdated(visitor.pid);
    return toConversationDto(conversation);
  }

  /** Возвращает диалог только его владельцу; иначе 404 (изоляция, docs/15 §2). */
  async getOwnedConversation(
    conversationId: string,
    visitor: { vid: string },
  ): Promise<ConversationRow> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation || conversation.visitor_id !== visitor.vid) {
      throw AppError.notFound("Диалог");
    }
    return conversation;
  }

  async listMessages(
    conversationId: string,
    visitor: { vid: string },
    afterSeq = 0,
  ): Promise<WidgetMessageDto[]> {
    await this.getOwnedConversation(conversationId, visitor);
    const rows = await this.conversations.listMessages(conversationId, afterSeq);
    return rows.map(toMessageDto);
  }

  async sendMessage(
    conversationId: string,
    visitor: { vid: string },
    text: string,
    idempotencyKey: string | undefined,
    ip: string | null,
  ): Promise<WidgetMessageDto> {
    const attempt = this.throttle.attempt(
      `w-msg:${visitor.vid}`,
      LIMITS.messagesPerMinute,
      60,
    );
    if (!attempt.allowed) throw AppError.rateLimited(attempt.retryAfterS);

    const conversation = await this.getOwnedConversation(conversationId, visitor);

    const idemCacheKey = idempotencyKey
      ? `${visitor.vid}:${conversation.id}:${idempotencyKey}`
      : null;
    if (idemCacheKey) {
      const cached = this.idempotency.get(idemCacheKey);
      if (cached && cached.expiresAt > Date.now()) return toMessageDto(cached.message);
    }

    const message = await this.conversations.appendMessage(
      conversation.id,
      MessageRole.Visitor,
      text,
    );
    if (idemCacheKey) {
      this.pruneIdempotency();
      this.idempotency.set(idemCacheKey, {
        message,
        expiresAt: Date.now() + WidgetService.IDEMPOTENCY_TTL_MS,
      });
    }

    this.gateway.emitMessage(conversation.id, toMessageDto(message));
    this.pushAdminMessage(conversation.project_id, message);
    if (message.state_after && message.state_after !== conversation.state) {
      // NEW → AI_ACTIVE или reopen RESOLVED/CLOSED → AI_ACTIVE (docs/13 §1)
      this.gateway.emitState(conversation.id, message.state_after);
      this.admin.emitStateChanged(conversation.project_id, conversation.id, message.state_after);
    }
    await this.events.append({
      actorType: "visitor",
      actorId: visitor.vid,
      action: "conversation.message_sent",
      entityType: "conversation",
      entityId: conversation.id,
      ip,
    });

    // AI-ход только пока диалог ведёт AI (docs/13: в OPERATOR_ACTIVE движок молчит)
    if (message.state_after === ConversationState.AiActive) {
      void this.engine.onVisitorMessage(conversation, text).catch((err: unknown) => {
        // fire-and-forget не должен ронять процесс молча (аудит IR-059)
        this.logger.error({ err, conversation_id: conversation.id }, "onVisitorMessage failed");
      });
    }
    return toMessageDto(message);
  }

  /** Вытеснение просроченных записей idempotency-кэша (Map рос безбрежно) */
  private pruneIdempotency(): void {
    const now = Date.now();
    for (const [key, entry] of this.idempotency) {
      if (entry.expiresAt <= now) this.idempotency.delete(key);
    }
    while (this.idempotency.size >= WidgetService.IDEMPOTENCY_MAX_ENTRIES) {
      const oldest = this.idempotency.keys().next().value;
      if (oldest === undefined) break;
      this.idempotency.delete(oldest);
    }
  }

  /** Явная просьба посетителя «позвать человека» (docs/14 §2). */
  async requestHandoff(
    conversationId: string,
    visitor: { vid: string },
    ip: string | null,
  ): Promise<{ ok: true }> {
    const conversation = await this.getOwnedConversation(conversationId, visitor);

    // NEW → AI_ACTIVE → WAITING_OPERATOR (переходы из NEW только в AI_ACTIVE — docs/13 §1).
    // Гонка двойного запроса разрешается условным UPDATE: проигравший получит 409 ниже.
    if (conversation.state === ConversationState.New) {
      const activated = await this.conversations.conditionalTransition(
        conversation.id,
        ConversationState.New,
        ConversationState.AiActive,
      );
      if (activated) {
        this.gateway.emitState(conversation.id, ConversationState.AiActive);
        this.admin.emitStateChanged(conversation.project_id, conversation.id, ConversationState.AiActive);
      }
    }

    await this.handoffs.createFromAiActive(conversation, {
      reason: HandoffReason.ExplicitRequest,
      requestedBy: HandoffRequestedBy.Visitor,
      actorType: "visitor",
      actorId: visitor.vid,
      ip,
    });
    return { ok: true };
  }

  /**
   * Офлайн-заявка (docs/07 §2.3, docs/13 §4): контакты фиксируются в контексте
   * диалога и events; диалог из WAITING_OPERATOR уходит в RESOLVED.
   */
  async leaveEmail(
    conversationId: string,
    visitor: { vid: string },
    input: z.infer<typeof LeaveEmailSchema>,
    ip: string | null,
  ): Promise<{ ok: true }> {
    const attempt = this.throttle.attempt(`w-email:${visitor.vid}`, LIMITS.emailPerMinute, 60);
    if (!attempt.allowed) throw AppError.rateLimited(attempt.retryAfterS);

    const conversation = await this.getOwnedConversation(conversationId, visitor);

    await this.conversations.mergeContext(conversation.id, {
      leave_email: input.email,
      ...(input.name ? { leave_name: input.name } : {}),
      leave_at: new Date().toISOString(),
    });

    const confirmation = await this.conversations.appendMessage(
      conversation.id,
      MessageRole.System,
      `Спасибо! Заявка принята${input.name ? `, ${input.name}` : ""}. Мы свяжемся с вами по адресу ${input.email}.`,
    );
    this.gateway.emitMessage(conversation.id, toMessageDto(confirmation));
    this.pushAdminMessage(conversation.project_id, confirmation);

    if (conversation.state === ConversationState.WaitingOperator) {
      // Офлайн-заявка обработана людьми → RESOLVED (docs/13 §1, §4);
      // возврат операторов не «воскрешает» диалог автоматически.
      const updated = await this.conversations.conditionalTransition(
        conversation.id,
        ConversationState.WaitingOperator,
        ConversationState.Resolved,
      );
      if (updated) {
        await this.handoffsRepo.resolvePendingForConversation(conversation.id, "cancelled");
        this.gateway.emitState(conversation.id, ConversationState.Resolved);
        this.admin.emitStateChanged(conversation.project_id, conversation.id, ConversationState.Resolved);
        this.admin.emitQueueUpdated(conversation.project_id);
      }
    }

    await this.events.append({
      actorType: "visitor",
      actorId: visitor.vid,
      action: "lead.captured",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { has_name: Boolean(input.name) },
      ip,
    });
    return { ok: true };
  }

  private pushAdminMessage(projectId: string, message: import("./widget.repos").WidgetMessageRow): void {
    const dto = toMessageDto(message);
    this.admin.emitMessage(projectId, {
      id: dto.id,
      conversation_id: dto.conversation_id,
      seq: dto.seq,
      role: dto.role as MessageRole,
      content: dto.content,
      created_at: dto.created_at,
      citations: dto.citations,
      confidence: dto.confidence,
    });
  }

  private widgetConfig(raw: Record<string, unknown>): WidgetConfig {
    const theme = (raw["theme"] as WidgetConfig["theme"] | undefined) ?? {};
    const texts = (raw["texts"] as { greeting?: string } | undefined) ?? {};
    return {
      locale: typeof raw["locale"] === "string" ? raw["locale"] : "ru",
      theme: {
        accent: theme.accent,
        position: theme.position,
      },
      greeting: texts.greeting ?? "",
    };
  }
}

function emptyAdminCard(conversation: ConversationRow): {
  id: string;
  project_id: string;
  site_id: string;
  state: ConversationState;
  assigned_operator_id: string | null;
  last_seq: number;
  last_message_at: string | null;
  handoff: null;
} {
  return {
    id: conversation.id,
    project_id: conversation.project_id,
    site_id: conversation.site_id,
    state: conversation.state,
    assigned_operator_id: null,
    last_seq: conversation.last_seq,
    last_message_at: null,
    handoff: null,
  };
}

function toConversationDto(row: ConversationRow): WidgetConversationDto {
  return { id: row.id, state: row.state, last_seq: row.last_seq };
}
