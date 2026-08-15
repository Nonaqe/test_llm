import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  accessibleProjectIds,
  canInstallation,
  Permission,
  type Principal,
} from "@uni-chat/core";
import { AppError } from "../common/http";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Auth, AuthedRequest, CurrentUser } from "../auth/jwt-auth.guard";
import { EventsRepo, ProjectsRepo, UsersRepo } from "../db/repositories";
import { ProjectGuard, ProjectPermission } from "./project.guard";

const CreateProjectSchema = z.object({ name: z.string().min(1).max(200) });
const RenameProjectSchema = z.object({ name: z.string().min(1).max(200) });
const AddMemberSchema = z.object({
  user_id: z.string().uuid().optional(),
  email: z.string().email().optional(),
  project_role: z.enum(["project_admin", "operator"]),
});

@Controller("projects")
@UseGuards(JwtAuthGuard, ProjectGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsRepo,
    private readonly users: UsersRepo,
    private readonly events: EventsRepo,
  ) {}

  /** GET /api/v1/projects — только доступные принципалу проекты (docs/15 §2). */
  @Get()
  @Auth()
  async list(@CurrentUser() user: Principal) {
    const access = accessibleProjectIds(user, Permission.UseInbox);
    return { projects: await this.projects.list(access.all ? null : access.projectIds) };
  }

  /** POST /api/v1/projects — installation-уровень (ManageProjects). */
  @Post()
  @Auth()
  async create(@Body() body: unknown, @CurrentUser() user: Principal & { userId: string }, @Req() req: AuthedRequest) {
    if (!canInstallation(user, Permission.ManageProjects)) {
      throw AppError.forbidden("Создание проектов доступно администраторам установки");
    }
    const { name } = CreateProjectSchema.parse(body);
    const project = await this.projects.insert(name);
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      ip: req.ip ?? null,
    });
    return { project };
  }

  /** GET /api/v1/projects/:id — просмотр (UseInbox достаточно). */
  @Get(":id")
  @Auth()
  @ProjectPermission()
  async get(@Param("id") id: string) {
    const project = await this.projects.findById(id);
    if (!project) throw AppError.notFound("Проект");
    return { project };
  }

  /** PATCH /api/v1/projects/:id — управление (ManageProject). */
  @Patch(":id")
  @Auth()
  @ProjectPermission(Permission.ManageProject)
  async rename(@Param("id") id: string, @Body() body: unknown) {
    const { name } = RenameProjectSchema.parse(body);
    await this.projects.rename(id, name);
    const project = await this.projects.findById(id);
    if (!project) throw AppError.notFound("Проект");
    return { project };
  }

  /** POST /api/v1/projects/:id/members — добавить/обновить участника. */
  @Post(":id/members")
  @Auth()
  @ProjectPermission(Permission.ManageProject)
  async addMember(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal & { userId: string },
  ) {
    const input = AddMemberSchema.parse(body);
    let targetUserId = input.user_id ?? null;
    if (!targetUserId && input.email) {
      const target = await this.users.findByEmail(input.email);
      if (!target) throw AppError.notFound("Пользователь");
      targetUserId = target.id;
    }
    if (!targetUserId) throw AppError.validation({ member: "нужен user_id или email" });

    await this.projects.addMember(id, targetUserId, input.project_role);
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "project.member_added",
      entityType: "project",
      entityId: id,
      payload: { target_user_id: targetUserId, role: input.project_role },
    });
    return { members: await this.projects.listMembers(id) };
  }

  /** GET /api/v1/projects/:id/members. */
  @Get(":id/members")
  @Auth()
  @ProjectPermission(Permission.ManageProject)
  async listMembers(@Param("id") id: string) {
    return { members: await this.projects.listMembers(id) };
  }
}
