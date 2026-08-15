/**
 * Репозитории публичной зоны виджета (docs/07 §2): sites, visitors,
 * conversations, messages, handoffs. Только параметризованные запросы.
 */
import { Inject, Injectable } from "@nestjs/common";
import { assertTransition } from "@uni-chat/core";
import { ConversationState, MessageRole } from "@uni-chat/shared";
import type { Pool } from "pg";
import { PG } from "../db/db.module";

export interface SiteRow {
  id: string;
  project_id: string;
  allowed_origins: string[];
  widget_config: Record<string, unknown>;
  is_active: boolean;
}

export interface ConversationRow {
  id: string;
  project_id: string;
  site_id: string;
  visitor_id: string;
  state: ConversationState;
  last_seq: number;
}

export interface WidgetMessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: string;
  content: string;
  created_at: Date;
  citations?: unknown;
  confidence?: number;
}

@Injectable()
export class SitesRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async findByKey(key: string): Promise<SiteRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, project_id, allowed_origins, widget_config, is_active
       from sites where widget_public_key = $1 limit 1`,
      [key],
    );
    const row = rows[0] as
      | (Omit<SiteRow, "allowed_origins" | "widget_config"> & {
          allowed_origins: string[];
          widget_config: Record<string, unknown>;
        })
      | undefined;
    if (!row) return null;
    return { ...row, allowed_origins: row.allowed_origins ?? [] };
  }
}

@Injectable()
export class VisitorsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  /** UPSERT по (project_id, anon_id); attributes обновляются только если переданы. */
  async upsert(
    projectId: string,
    anonId: string,
    attributes: Record<string, unknown>,
  ): Promise<string> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<{ id: string }>(
      `insert into visitors (project_id, anon_id, attributes)
       values ($1, $2, $3::jsonb)
       on conflict (project_id, anon_id) do update set
         last_seen = now(),
         attributes = case when $3::jsonb = '{}'::jsonb
           then visitors.attributes else excluded.attributes end
       returning id`,
      [projectId, anonId, JSON.stringify(attributes)],
    );
    return rows[0]!.id;
  }
}

@Injectable()
export class ConversationsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async create(input: {
    projectId: string;
    siteId: string;
    visitorId: string;
  }): Promise<ConversationRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `insert into conversations (project_id, site_id, visitor_id)
       values ($1, $2, $3)
       returning id, project_id, site_id, visitor_id, state, last_seq`,
      [input.projectId, input.siteId, input.visitorId],
    );
    return rows[0] as ConversationRow;
  }

  async findById(id: string): Promise<ConversationRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, project_id, site_id, visitor_id, state, last_seq
       from conversations where id = $1 limit 1`,
      [id],
    );
    return (rows[0] as ConversationRow) ?? null;
  }

  /** Последний незакрытый диалог посетителя (init возвращает его — docs/07 §2.1). */
  async findOpenForVisitor(visitorId: string): Promise<ConversationRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, project_id, site_id, visitor_id, state, last_seq
       from conversations
       where visitor_id = $1 and state in ('NEW','AI_ACTIVE','WAITING_OPERATOR','OPERATOR_ACTIVE')
       order by created_at desc limit 1`,
      [visitorId],
    );
    return (rows[0] as ConversationRow) ?? null;
  }

  /**
   * Атомарное добавление сообщения: seq = last_seq+1 в транзакции (docs/05 §3).
   * Первое сообщение переводит NEW → AI_ACTIVE.
   */
  async appendMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    citations?: Array<{ chunk_id: string; score: number }>,
    confidence?: number,
  ): Promise<WidgetMessageRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const client = await this.db.connect();
    try {
      await client.query("begin");
      const { rows: convRows } = await client.query(
        `update conversations
         set last_seq = last_seq + 1, last_message_at = now(), updated_at = now()
         where id = $1
         returning last_seq, state`,
        [conversationId],
      );
      const conv = convRows[0] as { last_seq: number; state: ConversationState } | undefined;
      if (!conv) throw new Error(`conversation ${conversationId} not found`);

      if (conv.state === ConversationState.New) {
        assertTransition(ConversationState.New, ConversationState.AiActive);
        await client.query(
          `update conversations set state = 'AI_ACTIVE', updated_at = now() where id = $1`,
          [conversationId],
        );
      }

      const { rows: msgRows } = await client.query(
        `insert into messages (conversation_id, seq, role, content, citations, confidence)
         values ($1, $2, $3, $4, $5::jsonb, $6)
         returning id, conversation_id, seq, role, content, created_at, citations, confidence`,
        [
          conversationId,
          conv.last_seq,
          role,
          content,
          citations ? JSON.stringify(citations) : null,
          confidence ?? null,
        ],
      );
      await client.query("commit");
      return msgRows[0] as WidgetMessageRow;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Кэтч-ап: только seq > afterSeq; заметки операторов не видны посетителю. */
  async listMessages(
    conversationId: string,
    afterSeq = 0,
  ): Promise<WidgetMessageRow[]> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, conversation_id, seq, role, content, created_at
       from messages
       where conversation_id = $1 and seq > $2 and role <> 'note'
       order by seq asc
       limit 500`,
      [conversationId, afterSeq],
    );
    return rows as WidgetMessageRow[];
  }

  /** Валидированный переход состояния (docs/13 §1); 409 на незаконный. */
  async transition(
    conversationId: string,
    from: ConversationState,
    to: ConversationState,
  ): Promise<void> {
    assertTransition(from, to);
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rowCount } = await this.db.query(
      `update conversations set state = $2, updated_at = now()
       where id = $1 and state = $3`,
      [conversationId, to, from],
    );
    if (rowCount === 0) throw new Error("state changed concurrently");
  }
}

@Injectable()
export class HandoffsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async insertPending(input: {
    conversationId: string;
    reason: string;
    requestedBy: "ai" | "visitor" | "operator";
  }): Promise<string> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<{ id: string }>(
      `insert into handoffs (conversation_id, reason, requested_by, status)
       values ($1, $2, $3, 'pending') returning id`,
      [input.conversationId, input.reason, input.requestedBy],
    );
    return rows[0]!.id;
  }
}
