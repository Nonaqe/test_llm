/**
 * SQL-репозитории Фазы 1 (docs/06): users, projects, members, settings, events.
 * Параметризованные запросы только (docs/15 §3).
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { PG } from "./db.module";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  installation_role: string | null;
  is_active: boolean;
}

export interface MembershipRow {
  project_id: string;
  project_role: string;
}

@Injectable()
export class UsersRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<UserRow>(
      "select id, email, password_hash, name, installation_role, is_active from users where lower(email) = lower($1) limit 1",
      [email],
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<UserRow>(
      "select id, email, password_hash, name, installation_role, is_active from users where id = $1 limit 1",
      [id],
    );
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<{ n: string }>("select count(*)::text as n from users");
    return Number(rows[0]?.n ?? 0);
  }

  async listAll(): Promise<Array<{ id: string; email: string; name: string; installation_role: string | null }>> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      "select id, email, name, installation_role from users where is_active order by created_at",
    );
    return rows as Array<{ id: string; email: string; name: string; installation_role: string | null }>;
  }

  async insert(input: {
    email: string;
    passwordHash: string;
    name: string;
    installationRole: "owner" | "admin" | null;
  }): Promise<UserRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<UserRow>(
      `insert into users (email, password_hash, name, installation_role)
       values ($1, $2, $3, $4)
       returning id, email, password_hash, name, installation_role, is_active`,
      [input.email, input.passwordHash, input.name, input.installationRole],
    );
    return rows[0] as UserRow;
  }

  async memberships(userId: string): Promise<MembershipRow[]> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<MembershipRow>(
      "select project_id, project_role from project_members where user_id = $1",
      [userId],
    );
    return rows;
  }
}

@Injectable()
export class ProjectsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async insert(name: string): Promise<{ id: string; name: string; created_at: string }> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      "insert into projects (name) values ($1) returning id, name, created_at",
      [name],
    );
    return rows[0] as { id: string; name: string; created_at: string };
  }

  async list(projectIds: string[] | null): Promise<Array<{ id: string; name: string; created_at: string }>> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    if (projectIds === null) {
      const { rows } = await this.db.query(
        "select id, name, created_at from projects order by created_at desc",
      );
      return rows as Array<{ id: string; name: string; created_at: string }>;
    }
    if (projectIds.length === 0) return [];
    const { rows } = await this.db.query(
      "select id, name, created_at from projects where id = any($1::uuid[]) order by created_at desc",
      [projectIds],
    );
    return rows as Array<{ id: string; name: string; created_at: string }>;
  }

  async findById(id: string): Promise<{ id: string; name: string } | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query("select id, name from projects where id = $1 limit 1", [id]);
    return (rows[0] as { id: string; name: string }) ?? null;
  }

  async rename(id: string, name: string): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query("update projects set name = $2, updated_at = now() where id = $1", [id, name]);
  }

  async addMember(projectId: string, userId: string, role: "project_admin" | "operator"): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query(
      `insert into project_members (user_id, project_id, project_role) values ($1, $2, $3)
       on conflict (user_id, project_id) do update set project_role = excluded.project_role`,
      [userId, projectId, role],
    );
  }

  async listMembers(projectId: string): Promise<
    Array<{ user_id: string; email: string; name: string; project_role: string }>
  > {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select pm.user_id, u.email, u.name, pm.project_role
       from project_members pm join users u on u.id = pm.user_id
       where pm.project_id = $1 order by u.email`,
      [projectId],
    );
    return rows as Array<{ user_id: string; email: string; name: string; project_role: string }>;
  }

  async findMembership(
    userId: string,
    projectId: string,
  ): Promise<{ project_role: string } | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      "select project_role from project_members where user_id = $1 and project_id = $2 limit 1",
      [userId, projectId],
    );
    return (rows[0] as { project_role: string }) ?? null;
  }
}

@Injectable()
export class SettingsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async get(key: string): Promise<{ value: unknown; is_secret: boolean } | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query<{ value: unknown; is_secret: boolean }>(
      "select value, is_secret from settings where key = $1 limit 1",
      [key],
    );
    return rows[0] ?? null;
  }

  async list(): Promise<Array<{ key: string; value: unknown; is_secret: boolean }>> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query("select key, value, is_secret from settings order by key");
    return rows as Array<{ key: string; value: unknown; is_secret: boolean }>;
  }

  async set(key: string, value: unknown, isSecret: boolean): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query(
      `insert into settings (key, value, is_secret, updated_at) values ($1, $2, $3, now())
       on conflict (key) do update set value = excluded.value, is_secret = excluded.is_secret, updated_at = now()`,
      [key, JSON.stringify(value), isSecret],
    );
  }
}

@Injectable()
export class EventsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  /** Append-only аудит (docs/15 §5). */
  async append(event: {
    actorType: "user" | "system" | "visitor";
    actorId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    payload?: Record<string, unknown>;
    ip?: string | null;
  }): Promise<void> {
    if (!this.db) return; // аудит не блокирует скелет без БД
    await this.db.query(
      `insert into events (actor_type, actor_id, action, entity_type, entity_id, payload, ip)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.actorType,
        event.actorId ?? null,
        event.action,
        event.entityType ?? null,
        event.entityId ?? null,
        JSON.stringify(event.payload ?? {}),
        event.ip ?? null,
      ],
    );
  }
}
