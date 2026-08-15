import { describe, expect, it } from "vitest";
import { InstallationRole, ProjectRole } from "@uni-chat/shared";
import {
  accessibleProjectIds,
  canInstallation,
  canProject,
  isInstallationManager,
  Permission,
  type Principal,
} from "../rbac";

const owner: Principal = {
  userId: "u-owner",
  installationRole: InstallationRole.Owner,
  memberships: [],
};

const admin: Principal = {
  userId: "u-admin",
  installationRole: InstallationRole.Admin,
  memberships: [],
};

/** Оператор проекта: без роли на установке */
const operator: Principal = {
  userId: "u-op",
  installationRole: null,
  memberships: [
    { projectId: "p1", projectRole: ProjectRole.Operator },
    { projectId: "p2", projectRole: ProjectRole.ProjectAdmin },
  ],
};

describe("RBAC: installation-уровень (docs/15 §2)", () => {
  it("owner может всё на уровне установки", () => {
    expect(canInstallation(owner, Permission.ManageInstallation)).toBe(true);
    expect(canInstallation(owner, Permission.ManageProjects)).toBe(true);
    expect(isInstallationManager(owner)).toBe(true);
  });

  it("admin управляет проектами, но не установкой", () => {
    expect(canInstallation(admin, Permission.ManageProjects)).toBe(true);
    expect(canInstallation(admin, Permission.ManageInstallation)).toBe(false);
  });

  it("оператор проекта не имеет installation-прав", () => {
    expect(isInstallationManager(operator)).toBe(false);
    expect(canInstallation(operator, Permission.ManageProjects)).toBe(false);
    expect(canInstallation(operator, Permission.ManageInstallation)).toBe(false);
  });
});

describe("RBAC: project-уровень", () => {
  it("owner/admin установки управляют любым проектом", () => {
    expect(canProject(owner, Permission.ManageProject, { projectId: "pX" })).toBe(true);
    expect(canProject(admin, Permission.UseInbox, { projectId: "pX" })).toBe(true);
  });

  it("project_admin управляет своим проектом", () => {
    expect(canProject(operator, Permission.ManageProject, { projectId: "p2" })).toBe(true);
  });

  it("operator не управляет проектом, но работает в inbox", () => {
    expect(canProject(operator, Permission.ManageProject, { projectId: "p1" })).toBe(false);
    expect(canProject(operator, Permission.UseInbox, { projectId: "p1" })).toBe(true);
  });

  it("без членства — отказ (изоляция арендаторов, E8)", () => {
    expect(canProject(operator, Permission.UseInbox, { projectId: "pX" })).toBe(false);
    expect(canProject(operator, Permission.ManageProject, { projectId: "pX" })).toBe(false);
  });
});

describe("RBAC: доступные проекты списком", () => {
  it("installation-роли видят все", () => {
    expect(accessibleProjectIds(owner, Permission.ManageProject)).toEqual({
      all: true,
      projectIds: [],
    });
    expect(accessibleProjectIds(admin, Permission.UseInbox)).toEqual({
      all: true,
      projectIds: [],
    });
  });

  it("участник для inbox видит все свои проекты", () => {
    const res = accessibleProjectIds(operator, Permission.UseInbox);
    expect(res).toEqual({ all: false, projectIds: ["p1", "p2"] });
  });

  it("для управления участнику доступны только его project_admin-проекты", () => {
    expect(accessibleProjectIds(operator, Permission.ManageProject)).toEqual({
      all: false,
      projectIds: ["p2"],
    });
  });

  it("пользователь без членств не видит ничего", () => {
    const lonely: Principal = { userId: "u", installationRole: null, memberships: [] };
    expect(accessibleProjectIds(lonely, Permission.UseInbox)).toEqual({
      all: false,
      projectIds: [],
    });
  });
});
