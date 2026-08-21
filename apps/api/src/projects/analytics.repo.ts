/**
 * Аналитика проекта для dashboard админки (docs/30 §Ф5): дневные ряды
 * диалогов/сообщений/handoff, тоталы, латентность первого ответа и топ низкой
 * релевантности. Только параметризованные запросы (docs/15 §3).
 *
 * Выбранные критерии (честно):
 * - ai_resolved_share: истории состояний в БД нет (поля resolved_by нет,
 *   conversations.state хранит лишь текущее значение), поэтому «закрыт без
 *   оператора» = у диалога нет ни одной записи в handoffs — любой переход в
 *   WAITING_OPERATOR/OPERATOR_ACTIVE фиксируется записью handoffs.
 * - avg_first_response_ms: от первого сообщения visitor до первого assistant
 *   после него (messages.created_at; роль assistant пишут только AI-ходы).
 * - low_relevance_top: пара «visitor → следующий за ним assistant». Ответ
 *   считается неудачным, если confidence < 0.5 ИЛИ confidence IS NULL:
 *   fallback-ходы движка (гейт релевантности / action=fallback_message)
 *   пишутся как assistant с confidence=NULL (ConversationEngineService.
 *   appendFallback), обычные ответы всегда несут confidence из structured
 *   output. Прощальные фразы при handoff пишутся ролью system и критерий
 *   не проходят.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { AnalyticsDayPoint, LowRelevanceItem, ProjectAnalyticsDto } from "@uni-chat/shared";
import { PG } from "../db/db.module";

const LOW_RELEVANCE_CONFIDENCE = 0.5;
const LOW_RELEVANCE_LIMIT = 5;
const TEXT_SNIPPET_LENGTH = 200;

@Injectable()
export class AnalyticsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  private get pool(): Pool {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    return this.db;
  }

  async projectAnalytics(projectId: string, from: Date, days: number): Promise<ProjectAnalyticsDto> {
    const [convDays, msgDays, handoffDays, totals, latency, lowRelevance] = await Promise.all([
      this.countByDay(
        `select to_char(date_trunc('day', c.created_at), 'YYYY-MM-DD') as day, count(*)::int as n
         from conversations c
         where c.project_id = $1 and c.created_at >= $2::timestamptz
         group by 1`,
        projectId,
        from,
      ),
      this.countByDay(
        `select to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD') as day, count(*)::int as n
         from messages m join conversations c on c.id = m.conversation_id
         where c.project_id = $1 and m.created_at >= $2::timestamptz
         group by 1`,
        projectId,
        from,
      ),
      this.countByDay(
        `select to_char(date_trunc('day', h.created_at), 'YYYY-MM-DD') as day, count(*)::int as n
         from handoffs h join conversations c on c.id = h.conversation_id
         where c.project_id = $1 and h.created_at >= $2::timestamptz
         group by 1`,
        projectId,
        from,
      ),
      this.totals(projectId, from),
      this.avgFirstResponseMs(projectId, from),
      this.lowRelevanceTop(projectId, from),
    ]);

    const dayPoints: AnalyticsDayPoint[] = [];
    const cursor = new Date(from);
    for (let i = 0; i < days; i++) {
      const key = toDateKey(cursor);
      dayPoints.push({
        date: key,
        conversations: convDays.get(key) ?? 0,
        messages: msgDays.get(key) ?? 0,
        handoffs: handoffDays.get(key) ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      days: dayPoints,
      totals: {
        conversations: totals.conversations,
        handoffs: totals.handoffs,
        handoff_rate:
          totals.conversations > 0 ? round4(totals.handoffs / totals.conversations) : null,
        ai_resolved_share:
          totals.conversations > 0 ? round4(totals.ai_resolved / totals.conversations) : null,
        avg_first_response_ms: latency,
      },
      low_relevance_top: lowRelevance,
    };
  }

  private async countByDay(sql: string, projectId: string, from: Date): Promise<Map<string, number>> {
    const { rows } = await this.pool.query<{ day: string; n: number }>(sql, [projectId, from]);
    return new Map(rows.map((r) => [r.day, Number(r.n)]));
  }

  /** Диалоги периода + сколько из них без единого handoff (см. комментарий модуля). */
  private async totals(projectId: string, from: Date): Promise<{ conversations: number; handoffs: number; ai_resolved: number }> {
    const { rows } = await this.pool.query<{
      conversations: number;
      ai_resolved: number;
    }>(
      `select count(*)::int as conversations,
              count(*) filter (
                where not exists (
                  select 1 from handoffs h where h.conversation_id = c.id
                )
              )::int as ai_resolved
       from conversations c
       where c.project_id = $1 and c.created_at >= $2::timestamptz`,
      [projectId, from],
    );
    const { rows: hRows } = await this.pool.query<{ n: number }>(
      `select count(*)::int as n
       from handoffs h join conversations c on c.id = h.conversation_id
       where c.project_id = $1 and h.created_at >= $2::timestamptz`,
      [projectId, from],
    );
    return {
      conversations: Number(rows[0]?.conversations ?? 0),
      ai_resolved: Number(rows[0]?.ai_resolved ?? 0),
      handoffs: Number(hRows[0]?.n ?? 0),
    };
  }

  /**
   * Среднее время первого ответа ассистента, мс: min(created_at) первого
   * visitor-сообщения диалога → первый assistant после него. null — таких пар нет.
   */
  private async avgFirstResponseMs(projectId: string, from: Date): Promise<number | null> {
    const { rows } = await this.pool.query<{ avg_ms: number | null }>(
      `with first_visitor as (
         select m.conversation_id, min(m.created_at) as ts
         from messages m join conversations c on c.id = m.conversation_id
         where c.project_id = $1 and c.created_at >= $2::timestamptz and m.role = 'visitor'
         group by m.conversation_id
       )
       select avg(extract(epoch from (fa.ts - fv.ts)) * 1000)::float8 as avg_ms
       from first_visitor fv
       join lateral (
         select min(m.created_at) as ts
         from messages m
         where m.conversation_id = fv.conversation_id and m.role = 'assistant' and m.created_at >= fv.ts
       ) fa on true
       where fa.ts is not null`,
      [projectId, from],
    );
    const value = rows[0]?.avg_ms;
    return value === null || value === undefined ? null : Math.round(Number(value));
  }

  /** Топ-5 текстов visitor-сообщений с неудачным ответом (критерий — см. комментарий модуля). */
  private async lowRelevanceTop(projectId: string, from: Date): Promise<LowRelevanceItem[]> {
    const { rows } = await this.pool.query<{ text: string; count: number }>(
      `with pairs as (
         select distinct on (v.id) v.id, v.content, a.confidence
         from messages v
         join conversations c on c.id = v.conversation_id
         join lateral (
           select m.confidence
           from messages m
           where m.conversation_id = v.conversation_id and m.seq > v.seq and m.role = 'assistant'
           order by m.seq asc
           limit 1
         ) a on true
         where c.project_id = $1 and v.role = 'visitor' and v.created_at >= $2::timestamptz
         order by v.id
       )
       select left(content, ${TEXT_SNIPPET_LENGTH}) as text, count(*)::int as count
       from pairs
       where confidence is null or confidence < ${LOW_RELEVANCE_CONFIDENCE}
       group by left(content, ${TEXT_SNIPPET_LENGTH})
       order by count desc, text asc
       limit ${LOW_RELEVANCE_LIMIT}`,
      [projectId, from],
    );
    return rows.map((r) => ({ text: r.text, count: Number(r.count) }));
  }
}

/** Локальная дата YYYY-MM-DD (ряд строится по локальной полуночи сервера). */
function toDateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
