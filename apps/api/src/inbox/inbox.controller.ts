/**
 * Приватная зона панели оператора (docs/07 §3 «Диалоги», «Очередь»):
 * GET /handoffs?status=pending, диалоги проекта, карточка/транскрипт/действия.
 * Роуты /conversations/:id проверяют проект в сервисе (ProjectGuard здесь не
 * применим: :id — идентификатор диалога, не проекта).
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard, Auth, CurrentUser } from "../auth/jwt-auth.guard";
import { ProjectGuard, ProjectPermission } from "../projects/project.guard";
import { Permission, type Principal } from "@uni-chat/core";
import { InboxService } from "./inbox.service";

const QueueQuery = z.object({
  status: z.enum(["pending"]).default("pending"),
});

const ListQuery = z.object({
  state: z.string().max(200).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const OperatorMessageSchema = z.object({
  text: z.string().min(1).max(4000),
  is_note: z.boolean().optional(),
});

const AssignSchema = z.object({
  user_id: z.string().uuid(),
});

@Controller("api/v1")
@UseGuards(JwtAuthGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  /** Очередь handoff по доступным проектам (docs/07 §3). */
  @Get("handoffs")
  @Auth()
  async queue(@Query() query: unknown, @CurrentUser() user: Principal) {
    const q = QueueQuery.parse(query ?? {});
    void q.status; // MVP: только pending
    return this.inbox.pendingQueue(user);
  }

  @Get("projects/:projectId/conversations")
  @UseGuards(ProjectGuard)
  @ProjectPermission(Permission.UseInbox)
  async listConversations(
    @Param("projectId") projectId: string,
    @Query() query: unknown,
    @CurrentUser() user: Principal,
  ) {
    const q = ListQuery.parse(query ?? {});
    return this.inbox.listConversations({
      user,
      projectId,
      states: q.state ? q.state.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      cursor: q.cursor,
      limit: q.limit,
    });
  }

  @Get("conversations/:id")
  @Auth()
  async getCard(@Param("id") id: string, @CurrentUser() user: Principal) {
    return { conversation: await this.inbox.getCard(user, id) };
  }

  @Get("conversations/:id/messages")
  @Auth()
  async listMessages(@Param("id") id: string, @CurrentUser() user: Principal) {
    return this.inbox.listMessages(user, id);
  }

  /** Ответ оператора (role=operator) или внутренняя заметка (role=note). */
  @Post("conversations/:id/messages")
  @Auth()
  async addMessage(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal,
  ) {
    const input = OperatorMessageSchema.parse(body);
    return {
      message: await this.inbox.addMessage(user, id, {
        text: input.text,
        isNote: input.is_note === true,
      }),
    };
  }

  @Post("conversations/:id/accept")
  @Auth()
  async accept(@Param("id") id: string, @CurrentUser() user: Principal) {
    return { conversation: await this.inbox.accept(user, id) };
  }

  @Post("conversations/:id/assign")
  @Auth()
  async assign(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: Principal,
  ) {
    const input = AssignSchema.parse(body);
    return { conversation: await this.inbox.assign(user, id, input.user_id) };
  }

  @Post("conversations/:id/return-to-ai")
  @Auth()
  async returnToAi(@Param("id") id: string, @CurrentUser() user: Principal) {
    return { conversation: await this.inbox.returnToAi(user, id) };
  }

  @Post("conversations/:id/close")
  @Auth()
  async close(@Param("id") id: string, @CurrentUser() user: Principal) {
    return { conversation: await this.inbox.close(user, id) };
  }

  @Post("conversations/:id/reopen")
  @Auth()
  async reopen(@Param("id") id: string, @CurrentUser() user: Principal) {
    return { conversation: await this.inbox.reopen(user, id) };
  }
}
