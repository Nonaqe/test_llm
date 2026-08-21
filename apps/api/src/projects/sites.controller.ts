/**
 * REST сайтов для админки (docs/30 §Ф5 «projects/sites», docs/08 §4):
 * список/создание в рамках проекта и точечные операции по siteId.
 * Изоляция арендаторов: siteId вне доступных проектов неотличим от
 * несуществующего → 404; членство без права управления → 403 FORBIDDEN_PROJECT.
 *
 * Право просмотра («ViewProject» из ТЗ Ф5) в RBAC-матрице core выражается
 * как UseInbox (packages/core в объём этой задачи не входит).
 */
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  canProject,
  isInstallationManager,
  Permission,
  type Principal,
} from "@uni-chat/core";
import type { AdminSiteDto } from "@uni-chat/shared";
import { AppError } from "../common/http";
import { JwtAuthGuard, Auth, AuthedRequest, CurrentUser } from "../auth/jwt-auth.guard";
import { ProjectGuard, ProjectPermission } from "./project.guard";
import { EventsRepo } from "../db/repositories";
import { generateWidgetPublicKey, SitesRepo, type AdminSiteRow } from "../widget/widget.repos";

/** Origin для allowlist виджета: scheme://host либо '*' (см. widget/origin.ts). */
const AllowedOriginSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((v) => v === "*" || /^[a-z][a-z0-9+.-]*:\/\//i.test(v), {
    message: "Ожидается origin вида scheme://host либо *",
  });

const WidgetConfigSchema = z.record(z.string(), z.unknown());

const CreateSiteSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$/i, "Домен без схемы и пути, например example.com"),
  allowed_origins: z.array(AllowedOriginSchema).max(50),
  widget_config: WidgetConfigSchema.optional(),
});

const PatchSiteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$/i, "Домен без схемы и пути, например example.com")
    .optional(),
  allowed_origins: z.array(AllowedOriginSchema).max(50).optional(),
  widget_config: WidgetConfigSchema.optional(),
  is_active: z.boolean().optional(),
});

function toDto(row: AdminSiteRow): AdminSiteDto {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    domain: row.domain,
    allowed_origins: row.allowed_origins ?? [],
    widget_public_key: row.widget_public_key,
    widget_config: row.widget_config ?? {},
    is_active: row.is_active,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

@Controller("api/v1")
@UseGuards(JwtAuthGuard, ProjectGuard)
export class SitesController {
  constructor(
    private readonly sites: SitesRepo,
    private readonly events: EventsRepo,
  ) {}

  /** GET /api/v1/projects/:projectId/sites — просмотр (UseInbox достаточно). */
  @Get("projects/:projectId/sites")
  @Auth()
  @ProjectPermission(Permission.UseInbox)
  async list(@Param("projectId") projectId: string) {
    const sites = await this.sites.listByProjects([projectId]);
    return { sites: sites.map(toDto) };
  }

  /** POST /api/v1/projects/:projectId/sites — управление (ManageProject). */
  @Post("projects/:projectId/sites")
  @Auth()
  @ProjectPermission(Permission.ManageProject)
  async create(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal & { userId: string },
    @Req() req: AuthedRequest,
  ) {
    const input = CreateSiteSchema.parse(body);
    const site = await this.sites.insert({
      projectId,
      name: input.name,
      domain: input.domain.toLowerCase(),
      allowedOrigins: input.allowed_origins,
      // Отдельного генератора ключа в кодовой базе нет — 24 байта base64url.
      widgetPublicKey: generateWidgetPublicKey(),
      widgetConfig: input.widget_config ?? {},
    });
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "site.created",
      entityType: "site",
      entityId: site.id,
      payload: { project_id: projectId, domain: site.domain },
      ip: req.ip ?? null,
    });
    return { site: toDto(site) };
  }

  /**
   * PATCH /api/v1/sites/:siteId — :siteId не проект, ProjectGuard здесь не
   * применим; доступ проверяется в обработчике (паттерн inbox.controller).
   */
  @Patch("sites/:siteId")
  @Auth()
  async patch(
    @Param("siteId") siteId: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal & { userId: string },
    @Req() req: AuthedRequest,
  ) {
    const patch = PatchSiteSchema.parse(body);
    if (
      patch.name === undefined &&
      patch.domain === undefined &&
      patch.allowed_origins === undefined &&
      patch.widget_config === undefined &&
      patch.is_active === undefined
    ) {
      // Пустой patch отклоняется как ошибка валидации (реестр кодов docs/07 §5)
      throw AppError.validation({ patch: "Не передано ни одного поля для обновления" });
    }
    // Доступ проверяется до обновления (404/403 — см. assertManageable)
    await this.assertManageable(user, siteId);
    const updated = await this.sites.update(siteId, {
      name: patch.name,
      domain: patch.domain === undefined ? undefined : patch.domain.toLowerCase(),
      allowed_origins: patch.allowed_origins,
      widget_config: patch.widget_config,
      is_active: patch.is_active,
    });
    if (!updated) throw AppError.notFound("Сайт");
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "site.updated",
      entityType: "site",
      entityId: updated.id,
      payload: { fields: Object.keys(patch) },
      ip: req.ip ?? null,
    });
    return { site: toDto(updated) };
  }

  /**
   * POST /api/v1/sites/:siteId/regenerate-key — перезапись widget_public_key;
   * старый ключ перестаёт работать немедленно (findByKey читает ту же колонку).
   */
  @Post("sites/:siteId/regenerate-key")
  @Auth()
  async regenerateKey(
    @Param("siteId") siteId: string,
    @CurrentUser() user: Principal & { userId: string },
    @Req() req: AuthedRequest,
  ) {
    await this.assertManageable(user, siteId);
    const updated = await this.sites.regenerateKey(siteId, generateWidgetPublicKey());
    if (!updated) throw AppError.notFound("Сайт");
    await this.events.append({
      actorType: "user",
      actorId: user.userId,
      action: "site.key_regenerated",
      entityType: "site",
      entityId: updated.id,
      ip: req.ip ?? null,
    });
    return { site: toDto(updated) };
  }

  /**
   * Двойной слой RBAC для site-роутов (docs/15 §2): сайт чужого проекта
   * (нет членства) → 404 NOT_FOUND; членство есть, права ManageProject нет →
   * 403 FORBIDDEN_PROJECT.
   */
  private async assertManageable(user: Principal, siteId: string): Promise<AdminSiteRow> {
    const site = await this.sites.findAdminById(siteId);
    if (!site) throw AppError.notFound("Сайт");
    if (!isInstallationManager(user) && !canProject(user, Permission.ManageProject, { projectId: site.project_id })) {
      const membership = user.memberships.some((m) => m.projectId === site.project_id);
      if (!membership) throw AppError.notFound("Сайт");
      throw AppError.forbiddenProject();
    }
    return site;
  }
}
