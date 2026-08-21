/**
 * Репозитории публичной зоны виджета (docs/07 §2): sites, visitors,
 * conversations, messages, handoffs. Только параметризованные запросы.
 */
import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
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

/** Полная строка sites для приватной зоны админки (docs/06 §4; Ф5 REST сайтов). */
export interface AdminSiteRow {
  id: string;
  project_id: string;
  name: string;
  domain: string;
  allowed_origins: string[];
  widget_public_key: string;
  widget_config: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Публичный ключ виджета. Отдельного генератора в кодовой базе нет (сайты до Ф5
 * создавались только SQL-инсертом в e2e) — 24 случайных байта в base64url.
 */
export function generateWidgetPublicKey(): string {
  return randomBytes(24).toString("base64url");
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
  /** Состояние диалога после записи сообщения (NEW/RESOLVED/CLOSED → AI_ACTIVE) */
  state_after?: ConversationState;
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

  // --- Приватная зона админки (Ф5 REST сайтов, docs/30 §Ф5) ---

  /** Сайты проектов; null — все (installation-менеджер). */
  async listByProjects(projectIds: string[] | null): Promise<AdminSiteRow[]> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    if (projectIds !== null && projectIds.length === 0) return [];
    const { rows } = await this.db.query(
      projectIds === null
        ? `select ${ADMIN_SITE_COLUMNS} from sites order by created_at asc`
        : `select ${ADMIN_SITE_COLUMNS} from sites where project_id = any($1::uuid[]) order by created_at asc`,
      projectIds === null ? [] : [projectIds],
    );
    return rows as AdminSiteRow[];
  }

  async findAdminById(siteId: string): Promise<AdminSiteRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select ${ADMIN_SITE_COLUMNS} from sites where id = $1 limit 1`,
      [siteId],
    );
    return (rows[0] as AdminSiteRow) ?? null;
  }

  async insert(input: {
    projectId: string;
    name: string;
    domain: string;
    allowedOrigins: string[];
    widgetPublicKey: string;
    widgetConfig: Record<string, unknown>;
  }): Promise<AdminSiteRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `insert into sites (project_id, name, domain, allowed_origins, widget_public_key, widget_config)
       values ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
       returning ${ADMIN_SITE_COLUMNS}`,
      [
        input.projectId,
        input.name,
        input.domain,
        JSON.stringify(input.allowedOrigins),
        input.widgetPublicKey,
        JSON.stringify(input.widgetConfig),
      ],
    );
    return rows[0] as AdminSiteRow;
  }

  /** Частичное обновление; возвращает null, если сайта нет. */
  async update(
    siteId: string,
    patch: Partial<Pick<AdminSiteRow, "name" | "domain" | "allowed_origins" | "widget_config" | "is_active">>,
  ): Promise<AdminSiteRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const sets: string[] = [];
    const params: unknown[] = [siteId];
    const add = (column: string, value: unknown): void => {
      params.push(typeof value === "object" && value !== null ? JSON.stringify(value) : value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.name !== undefined) add("name", patch.name);
    if (patch.domain !== undefined) add("domain", patch.domain);
    if (patch.allowed_origins !== undefined) add("allowed_origins", patch.allowed_origins);
    if (patch.widget_config !== undefined) add("widget_config", patch.widget_config);
    if (patch.is_active !== undefined) add("is_active", patch.is_active);
    if (sets.length === 0) return await this.findAdminById(siteId);
    const { rows } = await this.db.query(
      `update sites set ${sets.join(", ")}, updated_at = now()
       where id = $1
       returning ${ADMIN_SITE_COLUMNS}`,
      params,
    );
    return (rows[0] as AdminSiteRow) ?? null;
  }

  /**
   * Перезапись ключа: старый ключ перестаёт работать немедленно
   * (findByKey читает ту же колонку). null — сайта нет.
   */
  async regenerateKey(siteId: string, newKey: string): Promise<AdminSiteRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `update sites set widget_public_key = $2, updated_at = now()
       where id = $1
       returning ${ADMIN_SITE_COLUMNS}`,
      [siteId, newKey],
    );
    return (rows[0] as AdminSiteRow) ?? null;
  }
}

const ADMIN_SITE_COLUMNS =
  "id, project_id, name, domain, allowed_origins, widget_public_key, widget_config, is_active, created_at, updated_at";

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
   * Первое сообщение переводит NEW → AI_ACTIVE; сообщение посетителя в
   * RESOLVED/CLOSED переоткрывает диалог (docs/13 §1 — reopen).
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

      let stateAfter = conv.state;
      const reopenFrom: string[] = [ConversationState.New];
      if (role === MessageRole.Visitor) {
        // reopen посетителем (docs/13 §1): RESOLVED/CLOSED → AI_ACTIVE
        reopenFrom.push(ConversationState.Resolved, ConversationState.Closed);
      }
      if (
        reopenFrom.includes(conv.state) &&
        conv.state !== ConversationState.AiActive
      ) {
        assertTransition(conv.state, ConversationState.AiActive);
        await client.query(
          `update conversations set state = 'AI_ACTIVE', updated_at = now() where id = $1`,
          [conversationId],
        );
        stateAfter = ConversationState.AiActive;
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
      return { ...(msgRows[0] as WidgetMessageRow), state_after: stateAfter };
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

  /**
   * Оптимистичный конкурентный переход (docs/13 «Частые ошибки»: два оператора
   * на один диалог): UPDATE ... WHERE state = from; null — состояние уже другое.
   */
  async conditionalTransition(
    conversationId: string,
    from: ConversationState,
    to: ConversationState,
  ): Promise<ConversationRow | null> {
    assertTransition(from, to);
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `update conversations set state = $2, updated_at = now()
       where id = $1 and state = $3
       returning id, project_id, site_id, visitor_id, state, last_seq`,
      [conversationId, to, from],
    );
    return (rows[0] as ConversationRow) ?? null;
  }

  async setAssignment(conversationId: string, operatorId: string | null): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query(
      `update conversations set assigned_operator_id = $2, updated_at = now() where id = $1`,
      [conversationId, operatorId],
    );
  }

  /** Контекст диалога (jsonb): счётчик подряд fallback-ответов и лид-контакты. */
  async getContext(conversationId: string): Promise<Record<string, unknown>> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select context from conversations where id = $1 limit 1`,
      [conversationId],
    );
    return (rows[0]?.context as Record<string, unknown> | undefined) ?? {};
  }

  async mergeContext(conversationId: string, patch: Record<string, unknown>): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query(
      `update conversations set context = context || $2::jsonb, updated_at = now() where id = $1`,
      [conversationId, JSON.stringify(patch)],
    );
  }
}

@Injectable()
export class HandoffsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async insertPending(input: {
    conversationId: string;
    reason: string;
    requestedBy: "ai" | "visitor" | "operator";
    ruleId?: string | null;
  }): Promise<string> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<{ id: string }>(
      `insert into handoffs (conversation_id, reason, requested_by, status, rule_id)
       values ($1, $2, $3, 'pending', $4) returning id`,
      [input.conversationId, input.reason, input.requestedBy, input.ruleId ?? null],
    );
    return rows[0]!.id;
  }

  /** Последний handoff диалога (для карточки inbox — docs/13 §2). */
  async findLatestForConversation(conversationId: string): Promise<{
    id: string;
    reason: string;
    requested_by: string;
    rule_id: string | null;
    status: string;
    created_at: Date;
  } | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, reason, requested_by, rule_id, status, created_at
       from handoffs where conversation_id = $1
       order by created_at desc limit 1`,
      [conversationId],
    );
    return (rows[0] as {
      id: string;
      reason: string;
      requested_by: string;
      rule_id: string | null;
      status: string;
      created_at: Date;
    }) ?? null;
  }

  /** Очередь pending по проектам, FIFO (ждёт дольше всех — первым; docs/13 §2). */
  async listPendingByProjects(projectIds: string[]): Promise<
    Array<{
      id: string;
      conversation_id: string;
      project_id: string;
      reason: string;
      requested_by: string;
      rule_id: string | null;
      created_at: Date;
      conversation_state: string;
    }>
  > {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    if (projectIds.length === 0) return [];
    const { rows } = await this.db.query(
      `select h.id, h.conversation_id, c.project_id, h.reason, h.requested_by,
              h.rule_id, h.created_at, c.state as conversation_state
       from handoffs h join conversations c on c.id = h.conversation_id
       where h.status = 'pending' and c.project_id = any($1::uuid[])
       order by h.created_at asc limit 200`,
      [projectIds],
    );
    return rows as Array<{
      id: string;
      conversation_id: string;
      project_id: string;
      reason: string;
      requested_by: string;
      rule_id: string | null;
      created_at: Date;
      conversation_state: string;
    }>;
  }

  /**
   * Перевод статуса последнего pending-handoff диалога. Возвращает id или null,
   * если pending-записи нет (повторный accept/отмена — идемпотентны).
   */
  async resolvePendingForConversation(
    conversationId: string,
    status: "accepted" | "resolved" | "cancelled",
    operatorId?: string | null,
  ): Promise<string | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<{ id: string }>(
      `update handoffs set status = $2, operator_id = coalesce($3, operator_id),
              accepted_at = case when $2 = 'accepted' then now() else accepted_at end,
              resolved_at = case when $2 <> 'accepted' then now() else resolved_at end
       where id = (
         select id from handoffs
         where conversation_id = $1 and status = 'pending'
         order by created_at desc limit 1
       )
       returning id`,
      [conversationId, status, operatorId ?? null],
    );
    return rows[0]?.id ?? null;
  }
}
