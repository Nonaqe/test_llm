import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Auth } from "../auth/jwt-auth.guard";
import { ProjectGuard, ProjectPermission } from "../projects/project.guard";
import { Permission } from "@uni-chat/core";
import { AssistantsRepo } from "./assistants.repo";

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  locale: z.string().min(2).max(10).optional(),
  tone: z.string().min(2).max(50).optional(),
  company_description: z.string().max(5000).optional(),
  custom_instructions: z.string().max(5000).optional(),
  retrieval_settings: z
    .object({
      top_k: z.number().int().min(1).max(20).optional(),
      score_threshold: z.number().min(0).max(1).optional(),
      history_depth: z.number().int().min(0).max(50).optional(),
    })
    .optional(),
  safety_settings: z
    .object({
      denied_topics: z.array(z.string().max(100)).max(50).optional(),
      fallback_message: z.string().max(1000).optional(),
    })
    .optional(),
  widget_texts: z.object({ greeting: z.string().max(500).optional() }).optional(),
});

/** GET/PATCH /api/v1/projects/:projectId/assistant — настройки AI проекта (docs/22 §4). */
@Controller("api/v1/projects/:projectId/assistant")
@UseGuards(JwtAuthGuard, ProjectGuard)
@ProjectPermission(Permission.ManageProject)
export class AssistantsController {
  constructor(private readonly assistants: AssistantsRepo) {}

  @Get()
  @Auth()
  async get(@Param("projectId") projectId: string) {
    return { assistant: await this.assistants.ensureForProject(projectId) };
  }

  @Patch()
  @Auth()
  async patch(
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const patch = PatchSchema.parse(body);
    return { assistant: await this.assistants.update(projectId, patch) };
  }
}
