/**
 * Создание handoff (docs/13 §6, docs/14 §5): запись handoffs → WAITING_OPERATOR →
 * системное сообщение → уведомления (widget push, /admin push, аудит events).
 * Офлайн-сценарий: операторов нет онлайн → посетителю предлагается leave-email
 * (docs/13 §4). Единая точка для явной просьбы посетителя и RulesEngine.
 */
import { Injectable, Logger } from "@nestjs/common";
import { ConversationState, HandoffReason, HandoffRequestedBy, MessageRole } from "@uni-chat/shared";
import { AppError } from "../common/http";
import { EventsRepo } from "../db/repositories";
import { WidgetGateway } from "../realtime/widget.gateway";
import { AdminGateway } from "../realtime/admin.gateway";
import { PresenceService } from "../realtime/presence.service";
import {
  ConversationsRepo,
  HandoffsRepo,
  type ConversationRow,
  type WidgetMessageRow,
} from "../widget/widget.repos";
import { toMessageDto } from "../widget/message-dto";

/** Прощальная фраза AI при передаче (docs/14 §5.3; персонализация — Фаза 5). */
export const HANDOFF_PHRASE = "Передаю вас коллеге-оператору, одну минуту.";
/** Офлайн-сообщение: операторов нет онлайн (docs/13 §4). */
export const OFFLINE_PHRASE =
  "Сейчас операторы не в сети. Оставьте свой email — мы свяжемся с вами, как только вернёмся.";

@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(
    private readonly conversations: ConversationsRepo,
    private readonly handoffs: HandoffsRepo,
    private readonly events: EventsRepo,
    private readonly gateway: WidgetGateway,
    private readonly admin: AdminGateway,
    private readonly presence: PresenceService,
  ) {}

  /**
   * Ручной/правило-передача в WAITING_OPERATOR. Состояние меняется условным
   * UPDATE — единственный источник истины о текущем состоянии (переданный объект
   * может быть устаревшим после reopen/переходов); гонка двух одновременных
   * handoff даёт 409 ровно одному из них.
   */
  async createFromAiActive(
    conversation: ConversationRow,
    input: {
      reason: HandoffReason;
      ruleId?: string | null;
      requestedBy: HandoffRequestedBy;
      actorType: "user" | "system" | "visitor";
      actorId?: string | null;
      ip?: string | null;
    },
  ): Promise<{ handoffId: string }> {
    const updated = await this.conversations.conditionalTransition(
      conversation.id,
      ConversationState.AiActive,
      ConversationState.WaitingOperator,
    );
    if (!updated) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        "Диалог не в состоянии AI_ACTIVE, передача оператору невозможна",
      );
    }

    const handoffId = await this.handoffs.insertPending({
      conversationId: conversation.id,
      reason: input.reason,
      requestedBy: input.requestedBy,
      ruleId: input.ruleId ?? null,
    });

    // Прощальная фраза AI + офлайн-уведомление (docs/14 §5.3, docs/13 §4)
    await this.appendAndPush(conversation.id, MessageRole.Assistant, HANDOFF_PHRASE);
    if (!this.presence.isOnline(conversation.project_id)) {
      await this.appendAndPush(conversation.id, MessageRole.System, OFFLINE_PHRASE);
    }

    this.gateway.emitState(conversation.id, ConversationState.WaitingOperator);
    this.admin.emitStateChanged(conversation.project_id, conversation.id, ConversationState.WaitingOperator);
    this.admin.emitHandoffCreated(conversation.project_id, {
      conversation_id: conversation.id,
      handoff_id: handoffId,
      reason: input.reason,
    });

    await this.events.append({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: "handoff.created",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { handoff_id: handoffId, reason: input.reason, rule_id: input.ruleId ?? null },
      ip: input.ip ?? null,
    });
    return { handoffId };
  }

  /** Сообщение + пуш в обе зоны (widget и admin). */
  async appendAndPush(
    conversationId: string,
    role: MessageRole,
    content: string,
  ): Promise<WidgetMessageRow> {
    const message = await this.conversations.appendMessage(conversationId, role, content);
    this.gateway.emitMessage(conversationId, toMessageDto(message));
    const conversation = await this.conversations.findById(conversationId);
    if (conversation) {
      this.admin.emitMessage(conversation.project_id, {
        id: message.id,
        conversation_id: message.conversation_id,
        seq: message.seq,
        role: role,
        content: message.content,
        created_at: new Date(message.created_at).toISOString(),
      });
    }
    return message;
  }
}
