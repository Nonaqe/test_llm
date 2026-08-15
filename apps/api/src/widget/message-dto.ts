/** Маппинг строки messages → DTO публичной зоны (docs/07 §2). */
import type { WidgetMessageDto } from "@uni-chat/shared";
import type { WidgetMessageRow } from "./widget.repos";

export function toMessageDto(row: WidgetMessageRow): WidgetMessageDto {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    seq: row.seq,
    role: row.role as WidgetMessageDto["role"],
    content: row.content,
    created_at: new Date(row.created_at).toISOString(),
    ...(Array.isArray(row.citations)
      ? { citations: row.citations as WidgetMessageDto["citations"] }
      : {}),
    ...(typeof row.confidence === "number" ? { confidence: row.confidence } : {}),
  };
}
