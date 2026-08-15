import { Reflector } from "@nestjs/core";
import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import type { Principal } from "@uni-chat/core";
import { canProject, Permission } from "@uni-chat/core";
import { AppError } from "../common/http";
import type { AuthedRequest } from "../auth/jwt-auth.guard";

const PROJECT_PERMISSION_KEY = "project:permission";

/** Требуемая permission для project-роутов (по умолчанию UseInbox). */
export const ProjectPermission = (
  permission: Permission.ManageProject | Permission.UseInbox = Permission.UseInbox,
) => SetMetadata(PROJECT_PERMISSION_KEY, permission);

/**
 * Проверяет доступ к проекту из :projectId или :id (двойной слой RBAC — docs/15 §2).
 * Ставится после JwtAuthGuard.
 */
@Injectable()
export class ProjectGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const permission =
      this.reflector.get<Permission.ManageProject | Permission.UseInbox>(
        PROJECT_PERMISSION_KEY,
        ctx.getHandler(),
      ) ?? Permission.UseInbox;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user: (Principal & { email: string }) | undefined = req.user;
    if (!user) throw AppError.unauthorized();

    const projectId = (req.params.projectId ?? req.params.id) as string | undefined;
    if (!projectId) throw AppError.internal();

    if (!canProject(user, permission, { projectId })) {
      throw AppError.forbiddenProject();
    }
    return true;
  }
}
