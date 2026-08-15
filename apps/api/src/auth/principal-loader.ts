import { Injectable } from "@nestjs/common";
import type { Principal } from "@uni-chat/core";
import { InstallationRole, ProjectRole } from "@uni-chat/shared";
import { AppError } from "../common/http";
import { UsersRepo } from "../db/repositories";

/** Загружает Principal (роли + членства) из БД на каждый запрос — свежие права (docs/15 §2). */
@Injectable()
export class UsersPrincipalLoader {
  constructor(private readonly users: UsersRepo) {}

  async load(userId: string): Promise<Principal & { email: string }> {
    const user = await this.users.findById(userId);
    if (!user || !user.is_active) throw AppError.unauthorized();

    const memberships = (await this.users.memberships(userId)).map((m) => ({
      projectId: m.project_id,
      projectRole: m.project_role as ProjectRole,
    }));

    return {
      userId: user.id,
      email: user.email,
      installationRole: (user.installation_role as InstallationRole | null) ?? null,
      memberships,
    };
  }
}
