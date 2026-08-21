/**
 * Форматирование и человекочитаемые подписи для панели оператора (docs/13 §2–3).
 */
import { ApiError } from "./api/client";
import type {
  ConversationStateValue,
  HandoffReasonValue,
  MessageRoleValue,
} from "./api/types";

export const STATE_LABELS: Record<ConversationStateValue, string> = {
  NEW: "Новый",
  AI_ACTIVE: "AI отвечает",
  WAITING_OPERATOR: "Ждёт оператора",
  OPERATOR_ACTIVE: "У оператора",
  RESOLVED: "Решён",
  CLOSED: "Закрыт",
};

/** Подпись состояния; неизвестное значение сервера показываем как есть. */
export function stateLabel(state: string): string {
  return STATE_LABELS[state as ConversationStateValue] ?? state;
}

export const REASON_LABELS: Record<HandoffReasonValue, string> = {
  explicit_request: "Просил оператора",
  low_confidence: "Низкая уверенность AI",
  keyword: "Ключевое слово",
  intent: "Интент",
  complaint: "Жалоба",
  no_answer: "AI не смог ответить",
  manual: "Вручную",
};

/** Человекочитаемая причина handoff (docs/13 §2). */
export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason as HandoffReasonValue] ?? reason;
}

export const ROLE_LABELS: Record<MessageRoleValue, string> = {
  visitor: "Посетитель",
  assistant: "AI",
  operator: "Оператор",
  system: "Система",
  note: "Внутренняя заметка",
};

/** Время последнего сообщения: HH:MM для сегодня, ДД.ММ HH:MM иначе. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number): string => String(n).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? time : `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${time}`;
}

/**
 * Текст ошибки для UI: error.message из конверта; специальный текст для
 * 409 INVALID_STATE_TRANSITION (docs/13 §1 — переходы валидирует сервер).
 */
export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "INVALID_STATE_TRANSITION") {
      return "Действие недоступно: состояние диалога изменилось, обновите список";
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Неизвестная ошибка";
}
