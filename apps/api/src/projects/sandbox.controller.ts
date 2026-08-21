/**
 * POST /api/v1/projects/:projectId/sandbox/messages — тестовый диалог без
 * записи в БД (docs/30 §Ф5). ManageProject: ход расходует кредиты провайдера.
 */
import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { Permission } from "@uni-chat/core";
import { JwtAuthGuard, Auth } from "../auth/jwt-auth.guard";
import { ProjectGuard, ProjectPermission } from "./project.guard";
import { SandboxService } from "./sandbox.service";

const SandboxMessageSchema = z.object({
  text: z.string().min(1).max(2000),
});

@Controller("api/v1/projects/:projectId/sandbox")
@UseGuards(JwtAuthGuard, ProjectGuard)
@ProjectPermission(Permission.ManageProject)
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  @Post("messages")
  @Auth()
  async ask(@Param("projectId") projectId: string, @Body() body: unknown) {
    const input = SandboxMessageSchema.parse(body);
    return { answer: await this.sandbox.answer(projectId, input.text) };
  }
}
