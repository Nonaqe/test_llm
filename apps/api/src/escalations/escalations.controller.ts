/**
 * CRUD правил эскалации (docs/14 §3–4, docs/07 §3 «Ассистент: rules — Ф4»).
 * Простой/продвинутый режим админки — Фаза 5; здесь контракт API.
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { EscalationRuleDto } from "@uni-chat/shared";
import { EscalationAction, EscalationRuleType } from "@uni-chat/shared";
import { JwtAuthGuard, Auth } from "../auth/jwt-auth.guard";
import { ProjectGuard, ProjectPermission } from "../projects/project.guard";
import { Permission } from "@uni-chat/core";
import { AppError } from "../common/http";
import { AssistantsRepo } from "../assistants/assistants.repo";
import { EscalationsRepo } from "./escalations.repo";

/** Параметры валидируются по типу правила (docs/14 §3). */
const ParamsSchema = z.union([
  z.object({ threshold: z.number().min(0).max(1) }).passthrough(),
  z.object({ patterns: z.array(z.string().min(1).max(200)).min(1).max(20) }).passthrough(),
  z.object({ intent: z.string().min(1).max(100) }).passthrough(),
  z.object({ max_fallbacks: z.number().int().min(1).max(10) }).passthrough(),
  z.object({}).passthrough(),
]);

const CreateBaseSchema = z.object({
  priority: z.number().int().min(1).max(1000),
  type: z.nativeEnum(EscalationRuleType),
  params: ParamsSchema.default({}),
  action: z.nativeEnum(EscalationAction).default(EscalationAction.Handoff),
  enabled: z.boolean().default(true),
});

/** Параметры обязательны для типов, где они являются смыслом правила (docs/14 §3). */
const requireParams = (val: z.infer<typeof CreateBaseSchema>, ctx: z.RefinementCtx): void => {
  const p = val.params as Record<string, unknown>;
  const need = (key: string, message: string): void => {
    if (!(key in p)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["params"], message });
  };
  if (val.type === EscalationRuleType.LowConfidence) need("threshold", "Требуется threshold 0..1");
  if (val.type === EscalationRuleType.Keyword) need("patterns", "Требуется массив patterns");
  if (val.type === EscalationRuleType.Intent) need("intent", "Требуется intent");
  if (val.type === EscalationRuleType.NoAnswer) need("max_fallbacks", "Требуется max_fallbacks");
};

const CreateSchema = CreateBaseSchema.superRefine(requireParams);
const PatchSchema = CreateBaseSchema.partial();

function toDto(row: {
  id: string;
  assistant_id: string;
  priority: number;
  type: string;
  params: Record<string, unknown>;
  action: string;
  enabled: boolean;
}): EscalationRuleDto {
  return {
    id: row.id,
    assistant_id: row.assistant_id,
    priority: row.priority,
    type: row.type as EscalationRuleType,
    params: row.params ?? {},
    action: row.action as EscalationAction,
    enabled: row.enabled,
  };
}

@Controller("api/v1/projects/:projectId/assistant/rules")
@UseGuards(JwtAuthGuard, ProjectGuard)
@ProjectPermission(Permission.ManageProject)
export class EscalationsController {
  constructor(
    private readonly assistants: AssistantsRepo,
    private readonly rules: EscalationsRepo,
  ) {}

  @Get()
  @Auth()
  async list(@Param("projectId") projectId: string) {
    const assistant = await this.assistants.ensureForProject(projectId);
    await this.rules.ensureDefaults(assistant.id);
    return { rules: (await this.rules.listForAssistant(assistant.id)).map(toDto) };
  }

  @Post()
  @Auth()
  async create(@Param("projectId") projectId: string, @Body() body: unknown) {
    const input = CreateSchema.parse(body);
    const assistant = await this.assistants.ensureForProject(projectId);
    return {
      rule: toDto(
        await this.rules.create({
          assistantId: assistant.id,
          priority: input.priority,
          type: input.type,
          params: input.params as Record<string, unknown>,
          action: input.action,
          enabled: input.enabled,
        }),
      ),
    };
  }

  @Patch(":ruleId")
  @Auth()
  async patch(
    @Param("projectId") projectId: string,
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
  ) {
    const patch = PatchSchema.parse(body);
    await this.assertRuleInProject(projectId, ruleId);
    return {
      rule: toDto(
        await this.rules.update(ruleId, {
          priority: patch.priority,
          type: patch.type,
          params: patch.params as Record<string, unknown> | undefined,
          action: patch.action,
          enabled: patch.enabled,
        }),
      ),
    };
  }

  @Delete(":ruleId")
  @Auth()
  async remove(
    @Param("projectId") projectId: string,
    @Param("ruleId") ruleId: string,
  ): Promise<{ deleted: true }> {
    await this.assertRuleInProject(projectId, ruleId);
    await this.rules.delete(ruleId);
    return { deleted: true };
  }

  /** Изоляция арендаторов: правило чужого проекта неотличимо от несуществующего (docs/15 §2). */
  private async assertRuleInProject(projectId: string, ruleId: string): Promise<void> {
    const assistant = await this.assistants.ensureForProject(projectId);
    const rule = await this.rules.findById(ruleId);
    if (!rule || rule.assistant_id !== assistant.id) {
      throw AppError.notFound("Правило");
    }
  }
}
