/**
 * Публичная зона виджета (docs/07 §2): init → visitor JWT, диалоги, сообщения
 * с атомарным seq, кэтч-ап after_seq, явный handoff.
 * AI-ответ — ЗАГЛУШКА Фазы 2 (эхо); настоящий Conversation Engine — Фаза 3.
 */
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  ConversationState,
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
import { ConversationEngineService } from "../conversations/conversation-engine.service";
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
  type WidgetMessageRow,
} from "./widget.repos";

const LIMITS = {
  initPerMinute: 30,
  conversationsPerHour: 5,
  messagesPerMinute: 10,
} as const;

export const InitSchema = z.object({
  key: z.string().min(8).max(200),
  anon_id: z.string().min(8).max(100),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export const SendMessageSchema = z.object({
  text: z.string().min(1).max(4000),
});

@Injectable()
export class WidgetService {
  /** Идемпотентность POST сообщений: key → сообщение (in-memory; Redis — Фаза 4). */
  private readonly idempotency = new Map<string, { message: WidgetMessageRow; expiresAt: number }>();

  constructor(
    private readonly sites: SitesRepo,
    private readonly visitors: VisitorsRepo,
    private readonly conversations: ConversationsRepo,
    private readonly handoffs: HandoffsRepo,
    private readonly events: EventsRepo,
    private readonly gateway: WidgetGateway,
    private readonly engine: ConversationEngineService,
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

    if (idempotencyKey) {
      const cached = this.idempotency.get(idempotencyKey);
      if (cached && cached.expiresAt > Date.now()) return toMessageDto(cached.message);
    }

    const message = await this.conversations.appendMessage(
      conversation.id,
      MessageRole.Visitor,
      text,
    );
    if (idempotencyKey) {
      this.idempotency.set(idempotencyKey, {
        message,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
    }

    this.gateway.emitMessage(conversation.id, toMessageDto(message));
    if (conversation.state === ConversationState.New) {
      this.gateway.emitState(conversation.id, ConversationState.AiActive);
    }
    await this.events.append({
      actorType: "visitor",
      actorId: visitor.vid,
      action: "conversation.message_sent",
      entityType: "conversation",
      entityId: conversation.id,
      ip,
    });

    // AI-ход: retrieval → гейт → LLM-стрим → structured output (docs/05 §3, Фаза 3)
    void this.engine.onVisitorMessage(conversation, text);
    return toMessageDto(message);
  }

  /** Явная просьба посетителя «позвать человека» (docs/14 §2). */
  async requestHandoff(
    conversationId: string,
    visitor: { vid: string },
    ip: string | null,
  ): Promise<{ ok: true }> {
    const conversation = await this.getOwnedConversation(conversationId, visitor);

    // NEW → AI_ACTIVE → WAITING_OPERATOR (переходы из NEW только в AI_ACTIVE — docs/13 §1)
    if (conversation.state === ConversationState.New) {
      await this.conversations.transition(
        conversation.id,
        ConversationState.New,
        ConversationState.AiActive,
      );
      this.gateway.emitState(conversation.id, ConversationState.AiActive);
    }
    const current =
      conversation.state === ConversationState.New
        ? ConversationState.AiActive
        : conversation.state;
    if (current !== ConversationState.AiActive) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        `Handoff невозможен из состояния ${current}`,
      );
    }

    await this.handoffs.insertPending({
      conversationId: conversation.id,
      reason: "explicit_request",
      requestedBy: "visitor",
    });
    await this.conversations.transition(
      conversation.id,
      ConversationState.AiActive,
      ConversationState.WaitingOperator,
    );
    const note = await this.conversations.appendMessage(
      conversation.id,
      MessageRole.System,
      "Диалог передан оператору. Операторская панель подключается в Фазе 4 — сейчас вас обслужит AI-заглушка.",
    );
    this.gateway.emitState(conversation.id, ConversationState.WaitingOperator);
    this.gateway.emitMessage(conversation.id, toMessageDto(note));
    await this.events.append({
      actorType: "visitor",
      actorId: visitor.vid,
      action: "handoff.requested",
      entityType: "conversation",
      entityId: conversation.id,
      ip,
    });
    return { ok: true };
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



function toConversationDto(row: ConversationRow): WidgetConversationDto {
  return { id: row.id, state: row.state, last_seq: row.last_seq };
}
