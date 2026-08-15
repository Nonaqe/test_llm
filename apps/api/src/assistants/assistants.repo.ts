/** Репозиторий ассистентов (1:1 к проекту в MVP — docs/06 §3). */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PG } from "../db/db.module";

export interface AssistantRow {
  id: string;
  project_id: string;
  name: string;
  locale: string;
  tone: string;
  company_description: string;
  custom_instructions: string;
  retrieval_settings: {
    top_k?: number;
    score_threshold?: number;
    history_depth?: number;
  };
  safety_settings: {
    denied_topics?: string[];
    fallback_message?: string;
  };
  widget_texts: { greeting?: string };
}

@Injectable()
export class AssistantsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async findByProject(projectId: string): Promise<AssistantRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select id, project_id, name, locale, tone, company_description, custom_instructions,
              retrieval_settings, safety_settings, widget_texts
       from assistants where project_id = $1 limit 1`,
      [projectId],
    );
    return (rows[0] as AssistantRow) ?? null;
  }

  async ensureForProject(projectId: string): Promise<AssistantRow> {
    const existing = await this.findByProject(projectId);
    if (existing) return existing;
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query(
      `insert into assistants (project_id) values ($1)
       on conflict (project_id) do nothing`,
      [projectId],
    );
    return (await this.findByProject(projectId))!;
  }

  async update(
    projectId: string,
    patch: Partial<Pick<AssistantRow, "name" | "locale" | "tone" | "company_description" | "custom_instructions" | "retrieval_settings" | "safety_settings" | "widget_texts">>,
  ): Promise<AssistantRow> {
    await this.ensureForProject(projectId);
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const sets: string[] = [];
    const params: unknown[] = [projectId];
    const add = (column: string, value: unknown): void => {
      params.push(typeof value === "object" && value !== null ? JSON.stringify(value) : value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.name !== undefined) add("name", patch.name);
    if (patch.locale !== undefined) add("locale", patch.locale);
    if (patch.tone !== undefined) add("tone", patch.tone);
    if (patch.company_description !== undefined) add("company_description", patch.company_description);
    if (patch.custom_instructions !== undefined) add("custom_instructions", patch.custom_instructions);
    if (patch.retrieval_settings !== undefined) add("retrieval_settings", patch.retrieval_settings);
    if (patch.safety_settings !== undefined) add("safety_settings", patch.safety_settings);
    if (patch.widget_texts !== undefined) add("widget_texts", patch.widget_texts);
    if (sets.length > 0) {
      await this.db.query(
        `update assistants set ${sets.join(", ")}, updated_at = now() where project_id = $1`,
        params,
      );
    }
    return (await this.findByProject(projectId))!;
  }
}
