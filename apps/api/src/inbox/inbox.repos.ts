/**
 * Выборки панели оператора (docs/13 §2): карточки диалогов с причиной handoff,
 * полный транскрипт (включая заметки), очередь pending-handoff.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PG } from "../db/db.module";
import type { AdminConversationDto } from "@uni-chat/shared";

interface CardRow {
  id: string;
  project_id: string;
  site_id: string;
  state: string;
  assigned_operator_id: string | null;
  last_seq: number;
  last_message_at: Date | null;
  created_at: Date;
  h_id: string | null;
  h_reason: string | null;
  h_requested_by: string | null;
  h_rule_id: string | null;
  h_created_at: Date | null;
}

function toCard(row: CardRow): AdminConversationDto {
  return {
    id: row.id,
    project_id: row.project_id,
    site_id: row.site_id,
    state: row.state as AdminConversationDto["state"],
    assigned_operator_id: row.assigned_operator_id,
    last_seq: Number(row.last_seq),
    last_message_at: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    handoff:
      row.h_id && row.h_reason
        ? {
            id: row.h_id,
            reason: row.h_reason as AdminConversationDto["handoff"] extends null ? never : never,
            requested_by: row.h_requested_by as never,
            rule_id: row.h_rule_id,
            created_at: new Date(row.h_created_at!).toISOString(),
          }
        : null,
  };
}

const CARD_SELECT = `
  select c.id, c.project_id, c.site_id, c.state, c.assigned_operator_id,
         c.last_seq, c.last_message_at, c.created_at,
         h.id as h_id, h.reason as h_reason, h.requested_by as h_requested_by,
         h.rule_id as h_rule_id, h.created_at as h_created_at
  from conversations c
  left join lateral (
    select hh.id, hh.reason, hh.requested_by, hh.rule_id, hh.created_at
    from handoffs hh
    where hh.conversation_id = c.id and hh.status in ('pending', 'accepted')
    order by hh.created_at desc limit 1
  ) h on true`;

@Injectable()
export class InboxRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async listConversations(input: {
    projectIds: string[] | null;
    states: string[] | null;
    limit: number;
    offset: number;
  }): Promise<{ conversations: AdminConversationDto[]; next_cursor: string | null }> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const params: unknown[] = [];
    const where: string[] = [];
    if (input.projectIds === null) {
      // все проекты установки (owner/admin)
    } else if (input.projectIds.length === 0) {
      return { conversations: [], next_cursor: null };
    } else {
      params.push(input.projectIds);
      where.push(`c.project_id = any($${params.length}::uuid[])`);
    }
    if (input.states && input.states.length > 0) {
      params.push(input.states);
      where.push(`c.state = any($${params.length}::text[])`);
    }
    params.push(input.limit);
    const limitIdx = params.length;
    params.push(input.offset);
    const offsetIdx = params.length;

    const { rows } = await this.db.query(
      `${CARD_SELECT}
       ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
       order by c.last_message_at desc nulls last, c.created_at desc
       limit $${limitIdx} offset $${offsetIdx}`,
      params,
    );
    const conversations = (rows as CardRow[]).map(toCard);
    const nextCursor =
      conversations.length === input.limit ? String(input.offset + input.limit) : null;
    return { conversations, next_cursor: nextCursor };
  }

  async findCardById(conversationId: string): Promise<AdminConversationDto | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(`${CARD_SELECT} where c.id = $1 limit 1`, [
      conversationId,
    ]);
    const row = (rows as CardRow[])[0];
    return row ? toCard(row) : null;
  }

  /** Полный транскрипт для панели: включая заметки команды (docs/13 §3). */
  async listAllMessages(
    conversationId: string,
  ): Promise<
    Array<{
      id: string;
      conversation_id: string;
      seq: number;
      role: string;
      content: string;
      created_at: Date;
      citations: unknown;
      confidence: number | null;
    }>
  > {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, conversation_id, seq, role, content, created_at, citations, confidence
       from messages where conversation_id = $1 order by seq asc limit 1000`,
      [conversationId],
    );
    return rows as Array<{
      id: string;
      conversation_id: string;
      seq: number;
      role: string;
      content: string;
      created_at: Date;
      citations: unknown;
      confidence: number | null;
    }>;
  }
}
