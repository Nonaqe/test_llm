/**
 * Репозиторий правил эскалации (docs/14 §3, схема docs/06: escalation_rules).
 * Приоритеты уникальны в рамках ассистента (UNIQUE(assistant_id, priority)).
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PG } from "../db/db.module";
import { AppError } from "../common/http";
import type { EscalationRuleInput } from "@uni-chat/core";

export interface EscalationRuleRow {
  id: string;
  assistant_id: string;
  priority: number;
  type: string;
  params: Record<string, unknown>;
  action: string;
  enabled: boolean;
}

/** Дефолтный набор нового ассистента (docs/14 §4). */
const DEFAULT_RULES: Array<{
  priority: number;
  type: string;
  params: Record<string, unknown>;
  action: string;
}> = [
  { priority: 10, type: "explicit_request", params: {}, action: "handoff" },
  { priority: 20, type: "low_confidence", params: { threshold: 0.55 }, action: "handoff" },
  { priority: 30, type: "complaint", params: {}, action: "handoff" },
];

@Injectable()
export class EscalationsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async listForAssistant(assistantId: string): Promise<EscalationRuleRow[]> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, assistant_id, priority, type, params, action, enabled
       from escalation_rules where assistant_id = $1 order by priority asc`,
      [assistantId],
    );
    return rows as EscalationRuleRow[];
  }

  /** Дефолтные правила создаются один раз — при первом обращении к ассистенту. */
  async ensureDefaults(assistantId: string): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query(
      `insert into escalation_rules (assistant_id, priority, type, params, action)
       select $1, x.priority, x.type, x.params::jsonb, x.action
       from (values ${DEFAULT_RULES.map((_, i) => `($${2 + i * 4}, $${3 + i * 4}, $${4 + i * 4}::jsonb, $${5 + i * 4})`).join(", ")}) as x(priority, type, params, action)
       where not exists (select 1 from escalation_rules where assistant_id = $1)`,
      [
        assistantId,
        ...DEFAULT_RULES.flatMap((r) => [r.priority, r.type, JSON.stringify(r.params), r.action]),
      ],
    );
  }

  async findById(ruleId: string): Promise<EscalationRuleRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, assistant_id, priority, type, params, action, enabled
       from escalation_rules where id = $1 limit 1`,
      [ruleId],
    );
    return (rows[0] as EscalationRuleRow) ?? null;
  }

  async create(input: {
    assistantId: string;
    priority: number;
    type: string;
    params: Record<string, unknown>;
    action: string;
    enabled: boolean;
  }): Promise<EscalationRuleRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    try {
      const { rows } = await this.db.query(
        `insert into escalation_rules (assistant_id, priority, type, params, action, enabled)
         values ($1, $2, $3, $4::jsonb, $5, $6)
         returning id, assistant_id, priority, type, params, action, enabled`,
        [
          input.assistantId,
          input.priority,
          input.type,
          JSON.stringify(input.params),
          input.action,
          input.enabled,
        ],
      );
      return rows[0] as EscalationRuleRow;
    } catch (err) {
      throw mapRuleViolation(err);
    }
  }

  async update(
    ruleId: string,
    patch: Partial<Pick<EscalationRuleRow, "priority" | "type" | "params" | "action" | "enabled">>,
  ): Promise<EscalationRuleRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const sets: string[] = [];
    const params: unknown[] = [ruleId];
    const add = (column: string, value: unknown): void => {
      params.push(typeof value === "object" && value !== null ? JSON.stringify(value) : value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.priority !== undefined) add("priority", patch.priority);
    if (patch.type !== undefined) add("type", patch.type);
    if (patch.params !== undefined) add("params", patch.params);
    if (patch.action !== undefined) add("action", patch.action);
    if (patch.enabled !== undefined) add("enabled", patch.enabled);
    try {
      const { rows } = await this.db.query(
        `update escalation_rules set ${sets.join(", ")} where id = $1
         returning id, assistant_id, priority, type, params, action, enabled`,
        params,
      );
      return rows[0] as EscalationRuleRow;
    } catch (err) {
      throw mapRuleViolation(err);
    }
  }

  async delete(ruleId: string): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query("delete from escalation_rules where id = $1", [ruleId]);
  }

  /** Включённые правила ассистента для RulesEngine (docs/14 §5). */
  async enabledRules(assistantId: string): Promise<EscalationRuleInput[]> {
    const rows = await this.listForAssistant(assistantId);
    return rows
      .filter((r) => r.enabled)
      .map((r) => ({
        id: r.id,
        priority: r.priority,
        type: r.type as EscalationRuleInput["type"],
        params: r.params ?? {},
        action: r.action as EscalationRuleInput["action"],
        enabled: r.enabled,
      }));
  }
}

function mapRuleViolation(err: unknown): Error {
  const code = (err as { code?: string }).code;
  if (code === "23505") {
    // UNIQUE(assistant_id, priority) — приоритет занят (docs/14 «Частые ошибки»)
    return AppError.conflict(
      "RULE_PRIORITY_TAKEN",
      "Правило с таким приоритетом уже существует",
    );
  }
  if (code === "23514") {
    return AppError.validation({ issues: [{ path: "type", message: "Недопустимый тип правила" }] });
  }
  return err as Error;
}
