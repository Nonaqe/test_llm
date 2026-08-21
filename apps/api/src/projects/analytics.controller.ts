/**
 * Аналитика проекта для dashboard (docs/30 §Ф5 «Аналитика: диалоги/сутки,
 * handoff rate, разрешённые AI, латентность, топ низкой релевантности»).
 * Право просмотра («ViewProject» из ТЗ) — UseInbox в RBAC-матрице core.
 */
import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { Permission } from "@uni-chat/core";
import { JwtAuthGuard, Auth } from "../auth/jwt-auth.guard";
import { ProjectGuard, ProjectPermission } from "./project.guard";
import { AnalyticsRepo } from "./analytics.repo";

const AnalyticsQuerySchema = z.object({
  days: z.coerce.number().optional(),
});

const DEFAULT_DAYS = 14;

/** Локальная полночь (days-1) дней назад — начало периода ряда. */
function periodStart(days: number): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

@Controller("api/v1/projects/:projectId")
@UseGuards(JwtAuthGuard, ProjectGuard)
export class AnalyticsController {
  constructor(private readonly analyticsRepo: AnalyticsRepo) {}

  /** GET /api/v1/projects/:projectId/analytics?days=14 — окно clamp 1..90. */
  @Get("analytics")
  @Auth()
  @ProjectPermission(Permission.UseInbox)
  async analytics(@Param("projectId") projectId: string, @Query() query: unknown) {
    const parsed = AnalyticsQuerySchema.parse(query ?? {});
    // clamp 1..90 (не ошибка валидации — экстремальные значения срезаются);
    // нечисловой days отсеет z.coerce.number() (NaN невалиден для z.number())
    const days = Math.min(Math.max(Math.trunc(parsed.days ?? DEFAULT_DAYS), 1), 90);
    return {
      analytics: await this.analyticsRepo.projectAnalytics(projectId, periodStart(days), days),
    };
  }
}
