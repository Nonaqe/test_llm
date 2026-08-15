/**
 * RBAC-матрица (docs/15_SECURITY.md §2): installation-роли + project-роли.
 * installationRole === null — пользователь без роли на установке (оператор проекта).
 * Чистые функции — гарды api дублируют проверку в сервисах (двойной слой).
 */
import { InstallationRole, ProjectRole } from "@uni-chat/shared";

export enum Permission {
  ManageInstallation = "manage_installation", // команда, настройки установки
  ManageProjects = "manage_projects", // создание/удаление проектов
  ManageProject = "manage_project", // сайты, ассистент, знания, операторы проекта
  UseInbox = "use_inbox", // диалоги своих проектов
}

export interface Principal {
  userId: string;
  installationRole: InstallationRole | null;
  /** Членства пользователя в проектах */
  memberships: ReadonlyArray<{ projectId: string; projectRole: ProjectRole }>;
}

export interface ProjectScope {
  projectId: string;
}

export function isInstallationManager(principal: Principal): boolean {
  return (
    principal.installationRole === InstallationRole.Owner ||
    principal.installationRole === InstallationRole.Admin
  );
}

/**
 * Установка: owner управляет всем; admin — проектами, но не настройками установки
 * (граница admin/owner уточняется в Фазе 5; MVP: admin без ManageInstallation).
 */
export function canInstallation(
  principal: Principal,
  permission: Permission.ManageInstallation | Permission.ManageProjects,
): boolean {
  if (principal.installationRole === InstallationRole.Owner) return true;
  if (principal.installationRole === InstallationRole.Admin) {
    return permission === Permission.ManageProjects;
  }
  return false;
}

/** Проект: owner/admin установки — любые; project_admin — управление; operator — только inbox. */
export function canProject(
  principal: Principal,
  permission: Permission.ManageProject | Permission.UseInbox,
  scope: ProjectScope,
): boolean {
  if (isInstallationManager(principal)) return true;

  const membership = principal.memberships.find((m) => m.projectId === scope.projectId);
  if (!membership) return false;

  if (permission === Permission.UseInbox) {
    return (
      membership.projectRole === ProjectRole.Operator ||
      membership.projectRole === ProjectRole.ProjectAdmin
    );
  }
  return membership.projectRole === ProjectRole.ProjectAdmin;
}

/** Список проектов, доступных principal (для выборок списком). */
export function accessibleProjectIds(
  principal: Principal,
  permission: Permission.UseInbox | Permission.ManageProject,
): { all: boolean; projectIds: string[] } {
  if (isInstallationManager(principal)) {
    return { all: true, projectIds: [] };
  }
  const projectIds = principal.memberships
    .filter(
      (m) =>
        permission === Permission.UseInbox ||
        m.projectRole === ProjectRole.ProjectAdmin,
    )
    .map((m) => m.projectId);
  return { all: false, projectIds };
}
