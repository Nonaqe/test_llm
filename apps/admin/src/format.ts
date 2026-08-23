/**
 * Форматирование для панели оператора (docs/13 §2–3).
 * Подписи состояний/причин/ролей живут в i18n (state.*, reason.*, role.*) —
 * дублирующие словари удалены по итогам аудита IR-059.
 */
import { ApiError } from "./api/client";

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
