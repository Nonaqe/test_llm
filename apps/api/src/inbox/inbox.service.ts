/**
 * Бизнес-логика панели оператора (docs/13 §1–3): действия над диалогами с
 * валидацией state machine, оптимистичной конкурентностью (два оператора —
 * второй получает 409), аудитом events и пушами в /widget и /admin.
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  accessibleProjectIds,
  Permission,
  type Principal,
} from "@uni-chat/core";
import {
  ConversationState,
  MessageRole,
  type AdminConversationDto,
  type AdminMessageDto,
  type AdminPendingHandoffDto,
} from "@uni-chat/shared";
import { AppError } from "../common/http";
import { EventsRepo, ProjectsRepo } from "../db/repositories";
import { WidgetGateway } from "../realtime/widget.gateway";
import { AdminGateway } from "../realtime/admin.gateway";
import {
  ConversationsRepo,
  HandoffsRepo,
  type ConversationRow,
} from "../widget/widget.repos";
import { InboxRepo } from "./inbox.repos";

export type InboxAction = "accept" | "assign" | "return-to-ai" | "close" | "reopen";

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly inboxRepo: InboxRepo,
    private readonly conversations: ConversationsRepo,
    private readonly handoffs: HandoffsRepo,
    private readonly projects: ProjectsRepo,
    private readonly events: EventsRepo,
    private readonly gateway: WidgetGateway,
    private readonly admin: AdminGateway,
  ) {}

  /** Очередь pending-handoff по проектам, доступным оператору (docs/07 §3). */
  async pendingQueue(user: Principal): Promise<{ handoffs: AdminPendingHandoffDto[] }> {
    const scope = accessibleProjectIds(user, Permission.UseInbox);
    const projectIds = scope.all ? null : scope.projectIds;
    if (projectIds !== null && projectIds.length === 0) return { handoffs: [] };
    const rows =
      projectIds === null
        ? await this.handoffs.listPendingByProjects((await this.allProjectIds()))
        : await this.handoffs.listPendingByProjects(projectIds);
    return {
      handoffs: rows.map((h) => ({
        id: h.id,
        conversation_id: h.conversation_id,
        project_id: h.project_id,
        reason: h.reason as AdminPendingHandoffDto["reason"],
        requested_by: h.requested_by as AdminPendingHandoffDto["requested_by"],
        rule_id: h.rule_id,
        created_at: new Date(h.created_at).toISOString(),
        conversation_state: h.conversation_state as AdminPendingHandoffDto["conversation_state"],
      })),
    };
  }

  async listConversations(input: {
    user: Principal;
    projectId?: string;
    states?: string[];
    cursor?: string;
    limit?: number;
  }): Promise<{ conversations: AdminConversationDto[]; next_cursor: string | null }> {
    let projectIds: string[] | null;
    if (input.projectId) {
      // ProjectGuard уже проверил доступ (двойной слой — docs/15 §2)
      projectIds = [input.projectId];
    } else {
      const scope = accessibleProjectIds(input.user, Permission.UseInbox);
      projectIds = scope.all ? null : scope.projectIds;
    }
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = Number.parseInt(input.cursor ?? "0", 10) || 0;
    return this.inboxRepo.listConversations({
      projectIds,
      states: input.states ?? null,
      limit,
      offset,
    });
  }

  async getCard(user: Principal, conversationId: string): Promise<AdminConversationDto> {
    await this.assertAccessible(user, conversationId);
    const card = await this.inboxRepo.findCardById(conversationId);
    if (!card) throw AppError.notFound("Диалог");
    return card;
  }

  /** Полный транскрипт включая заметки (docs/13 §2 — прозрачность решений AI). */
  async listMessages(
    user: Principal,
    conversationId: string,
  ): Promise<{ messages: AdminMessageDto[] }> {
    await this.assertAccessible(user, conversationId);
    const rows = await this.inboxRepo.listAllMessages(conversationId);
    return {
      messages: rows.map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        seq: Number(m.seq),
        role: m.role as MessageRole,
        content: m.content,
        created_at: new Date(m.created_at).toISOString(),
        ...(Array.isArray(m.citations) ? { citations: m.citations as AdminMessageDto["citations"] } : {}),
        ...(typeof m.confidence === "number" ? { confidence: m.confidence } : {}),
      })),
    };
  }

  /** Ответ оператора / внутренняя заметка (docs/13 §3): AI в OPERATOR_ACTIVE молчит. */
  async addMessage(
    user: Principal,
    conversationId: string,
    input: { text: string; isNote: boolean },
  ): Promise<AdminMessageDto> {
    const conversation = await this.assertAccessible(user, conversationId);

    if (input.isNote) {
      if (conversation.state === ConversationState.Resolved || conversation.state === ConversationState.Closed) {
        throw AppError.conflict(
          "INVALID_STATE_TRANSITION",
          `Заметка невозможна из состояния ${conversation.state}`,
        );
      }
    } else if (conversation.state !== ConversationState.OperatorActive) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        `Ответ оператора возможен только в OPERATOR_ACTIVE (сейчас ${conversation.state})`,
      );
    }

    const message = await this.conversations.appendMessage(
      conversation.id,
      input.isNote ? MessageRole.Note : MessageRole.Operator,
      input.text,
    );
    this.gateway.emitMessage(conversation.id, {
      id: message.id,
      conversation_id: message.conversation_id,
      seq: message.seq,
      role: "operator",
      content: message.content,
      created_at: new Date(message.created_at).toISOString(),
    });
    this.admin.emitMessage(conversation.project_id, {
      id: message.id,
      conversation_id: message.conversation_id,
      seq: message.seq,
      role: input.isNote ? MessageRole.Note : MessageRole.Operator,
      content: message.content,
      created_at: new Date(message.created_at).toISOString(),
    });
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: input.isNote ? "conversation.note_added" : "conversation.operator_replied",
      entityType: "conversation",
      entityId: conversation.id,
    });
    return {
      id: message.id,
      conversation_id: message.conversation_id,
      seq: message.seq,
      role: input.isNote ? MessageRole.Note : MessageRole.Operator,
      content: message.content,
      created_at: new Date(message.created_at).toISOString(),
    };
  }

  /**
   * Принять диалог: WAITING_OPERATOR → OPERATOR_ACTIVE. Гонка двух операторов
   * разрешается условным UPDATE — второй получает 409 (docs/13 «Частые ошибки»).
   */
  async accept(user: Principal, conversationId: string): Promise<AdminConversationDto> {
    const conversation = await this.assertAccessible(user, conversationId);
    if (conversation.state !== ConversationState.WaitingOperator) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        `Принять можно только из WAITING_OPERATOR (сейчас ${conversation.state})`,
      );
    }
    const updated = await this.conversations.conditionalTransition(
      conversation.id,
      ConversationState.WaitingOperator,
      ConversationState.OperatorActive,
    );
    if (!updated) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        "Диалог уже принят другим оператором",
      );
    }
    await this.conversations.setAssignment(conversation.id, user.userId);
    await this.handoffs.resolvePendingForConversation(conversation.id, "accepted", user.userId);
    await this.logAndPush(conversation, ConversationState.OperatorActive, "conversation.accepted", user.userId);
    return (await this.inboxRepo.findCardById(conversation.id))!;
  }

  /** Назначить на другого участника проекта (docs/13 §3). */
  async assign(
    user: Principal,
    conversationId: string,
    targetUserId: string,
  ): Promise<AdminConversationDto> {
    const conversation = await this.assertAccessible(user, conversationId);
    if (conversation.state !== ConversationState.OperatorActive) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        `Назначение возможно только в OPERATOR_ACTIVE (сейчас ${conversation.state})`,
      );
    }
    const membership = await this.projects.findMembership(targetUserId, conversation.project_id);
    if (!membership) throw AppError.notFound("Участник проекта");
    await this.conversations.setAssignment(conversation.id, targetUserId);
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "conversation.assigned",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { assigned_to: targetUserId },
    });
    this.admin.emitQueueUpdated(conversation.project_id);
    return (await this.inboxRepo.findCardById(conversation.id))!;
  }

  /** Вернуть чат AI: OPERATOR_ACTIVE → AI_ACTIVE, AI продолжает с контекстом (E6). */
  async returnToAi(user: Principal, conversationId: string): Promise<AdminConversationDto> {
    const conversation = await this.assertAccessible(user, conversationId);
    if (conversation.state !== ConversationState.OperatorActive) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        `Вернуть AI можно только из OPERATOR_ACTIVE (сейчас ${conversation.state})`,
      );
    }
    const updated = await this.conversations.conditionalTransition(
      conversation.id,
      ConversationState.OperatorActive,
      ConversationState.AiActive,
    );
    if (!updated) throw this.race();
    await this.handoffs.resolvePendingForConversation(conversation.id, "resolved");
    await this.conversations.setAssignment(conversation.id, null);
    await this.systemMessage(conversation.id, "Оператор вернул диалог AI-ассистенту.");
    await this.logAndPush(conversation, ConversationState.AiActive, "conversation.returned_to_ai", user.userId);
    return (await this.inboxRepo.findCardById(conversation.id))!;
  }

  /** Закрыть: → RESOLVED (из AI_ACTIVE/WAITING_OPERATOR/OPERATOR_ACTIVE — docs/13 §1). */
  async close(user: Principal, conversationId: string): Promise<AdminConversationDto> {
    const conversation = await this.assertAccessible(user, conversationId);
    const allowed = [
      ConversationState.AiActive,
      ConversationState.WaitingOperator,
      ConversationState.OperatorActive,
    ];
    if (!allowed.includes(conversation.state)) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        `Закрытие невозможно из состояния ${conversation.state}`,
      );
    }
    const updated = await this.conversations.conditionalTransition(
      conversation.id,
      conversation.state,
      ConversationState.Resolved,
    );
    if (!updated) throw this.race();
    if (conversation.state === ConversationState.WaitingOperator) {
      await this.handoffs.resolvePendingForConversation(conversation.id, "cancelled");
    }
    await this.logAndPush(conversation, ConversationState.Resolved, "conversation.closed", user.userId);
    return (await this.inboxRepo.findCardById(conversation.id))!;
  }

  /** Reopen: RESOLVED/CLOSED → AI_ACTIVE (docs/13 §1). */
  async reopen(user: Principal, conversationId: string): Promise<AdminConversationDto> {
    const conversation = await this.assertAccessible(user, conversationId);
    const allowed = [ConversationState.Resolved, ConversationState.Closed];
    if (!allowed.includes(conversation.state)) {
      throw AppError.conflict(
        "INVALID_STATE_TRANSITION",
        `Reopen возможен из RESOLVED/CLOSED (сейчас ${conversation.state})`,
      );
    }
    const updated = await this.conversations.conditionalTransition(
      conversation.id,
      conversation.state,
      ConversationState.AiActive,
    );
    if (!updated) throw this.race();
    await this.conversations.setAssignment(conversation.id, null);
    await this.logAndPush(conversation, ConversationState.AiActive, "conversation.reopened", user.userId);
    return (await this.inboxRepo.findCardById(conversation.id))!;
  }

  // --- Вспомогательные ---

  /** Доступ к чужому проекту → 403 FORBIDDEN_PROJECT (реестр кодов docs/07 §5). */
  private async assertAccessible(
    user: Principal,
    conversationId: string,
  ): Promise<ConversationRow> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation) throw AppError.notFound("Диалог");
    const scope = accessibleProjectIds(user, Permission.UseInbox);
    const ok = scope.all || scope.projectIds.includes(conversation.project_id);
    if (!ok) throw AppError.forbiddenProject();
    return conversation;
  }

  private race(): AppError {
    return AppError.conflict("INVALID_STATE_TRANSITION", "Состояние диалога изменилось, обновите данные");
  }

  private async systemMessage(conversationId: string, text: string): Promise<void> {
    const message = await this.conversations.appendMessage(conversationId, MessageRole.System, text);
    this.gateway.emitMessage(conversationId, {
      id: message.id,
      conversation_id: message.conversation_id,
      seq: message.seq,
      role: "system",
      content: message.content,
      created_at: new Date(message.created_at).toISOString(),
    });
    const conversation = await this.conversations.findById(conversationId);
    if (conversation) {
      this.admin.emitMessage(conversation.project_id, {
        id: message.id,
        conversation_id: message.conversation_id,
        seq: message.seq,
        role: MessageRole.System,
        content: message.content,
        created_at: new Date(message.created_at).toISOString(),
      });
    }
  }

  /** Аудит + пуши состояния в обе зоны (docs/13 §1: переходы логируются и пушатся). */
  private async logAndPush(
    conversation: ConversationRow,
    to: ConversationState,
    action: string,
    userId: string,
  ): Promise<void> {
    this.gateway.emitState(conversation.id, to);
    this.admin.emitStateChanged(conversation.project_id, conversation.id, to);
    this.admin.emitQueueUpdated(conversation.project_id);
    await this.events.append({
      actorType: "user",
      actorId: userId,
      action,
      entityType: "conversation",
      entityId: conversation.id,
      payload: { from: conversation.state, to },
    });
  }

  private async allProjectIds(): Promise<string[]> {
    if (!this.projects) return [];
    const rows = await this.projects.list(null);
    return rows.map((r) => r.id);
  }
}
