/**
 * State machine диалога — единственный источник переходов (docs/13_OPERATOR_PANEL.md §1).
 * Сервер валидирует каждый переход; незаконный → ошибка (API: 409 INVALID_STATE_TRANSITION).
 */
import { ConversationState } from "@uni-chat/shared";

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: ConversationState,
    public readonly to: ConversationState,
  ) {
    super(`Invalid conversation state transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

/**
 * Допустимые переходы (по диаграмме docs/13 §1):
 * NEW → AI_ACTIVE
 * AI_ACTIVE → WAITING_OPERATOR | RESOLVED (авто-таймаут)
 * WAITING_OPERATOR → OPERATOR_ACTIVE | AI_ACTIVE (отмена/таймаут) | RESOLVED (офлайн-заявка)
 * OPERATOR_ACTIVE → AI_ACTIVE (вернуть AI) | RESOLVED
 * RESOLVED → CLOSED | AI_ACTIVE (reopen)
 * CLOSED → AI_ACTIVE (reopen новым сообщением)
 */
const TRANSITIONS: Readonly<Record<ConversationState, readonly ConversationState[]>> = {
  [ConversationState.New]: [ConversationState.AiActive],
  [ConversationState.AiActive]: [
    ConversationState.WaitingOperator,
    ConversationState.Resolved,
  ],
  [ConversationState.WaitingOperator]: [
    ConversationState.OperatorActive,
    ConversationState.AiActive,
    ConversationState.Resolved,
  ],
  [ConversationState.OperatorActive]: [
    ConversationState.AiActive,
    ConversationState.Resolved,
  ],
  [ConversationState.Resolved]: [ConversationState.Closed, ConversationState.AiActive],
  [ConversationState.Closed]: [ConversationState.AiActive],
};

export function allowedTransitions(from: ConversationState): readonly ConversationState[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: ConversationState, to: ConversationState): boolean {
  return allowedTransitions(from).includes(to);
}

/** Бросает InvalidStateTransitionError, если переход незаконен. */
export function assertTransition(from: ConversationState, to: ConversationState): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}
