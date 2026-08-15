import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { HealthResponse } from "@uni-chat/shared";
import { ENV, type Env } from "../config/env";
import { VisitorGuard, type VisitorRequest } from "./visitor.guard";
import { InitSchema, SendMessageSchema, WidgetService } from "./widget.service";

const AfterSeqQuery = z.coerce.number().int().min(0).default(0);

@Controller("widget/v1")
export class WidgetController {
  constructor(
    private readonly widget: WidgetService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Публичный статус для мониторинга и WP-плагина (docs/07 §2). */
  @Get("health")
  health(): HealthResponse {
    return {
      status: "ok",
      version: this.env.APP_VERSION,
      uptime_s: Math.round(process.uptime()),
    };
  }

  /** POST /widget/v1/init — publishable key + заголовок Origin → visitor JWT + конфиг. */
  @Post("init")
  @HttpCode(200)
  async init(@Body() body: unknown, @Req() req: Request) {
    const input = InitSchema.parse(body);
    const headerOrigin = Array.isArray(req.headers.origin)
      ? req.headers.origin[0]
      : req.headers.origin;
    return this.widget.init(input, headerOrigin, req.ip ?? null);
  }

  @Post("conversations")
  @UseGuards(VisitorGuard)
  async createConversation(@Req() req: VisitorRequest) {
    return {
      conversation: await this.widget.createConversation(req.visitor!),
    };
  }

  @Get("conversations/:id")
  @UseGuards(VisitorGuard)
  async getConversation(@Param("id") id: string, @Req() req: VisitorRequest) {
    const conversation = await this.widget.getOwnedConversation(id, req.visitor!);
    return { conversation: { id: conversation.id, state: conversation.state, last_seq: conversation.last_seq } };
  }

  /** Кэтч-ап после reconnect: сообщения с seq > after_seq (docs/07 §2). */
  @Get("conversations/:id/messages")
  @UseGuards(VisitorGuard)
  async listMessages(
    @Param("id") id: string,
    @Query("after_seq") afterSeq: unknown,
    @Req() req: VisitorRequest,
  ) {
    const parsed = AfterSeqQuery.parse(afterSeq ?? 0);
    return { messages: await this.widget.listMessages(id, req.visitor!, parsed) };
  }

  /** Сообщение посетителя: Idempotency-Key обязателен (docs/07 §1). */
  @Post("conversations/:id/messages")
  @UseGuards(VisitorGuard)
  async sendMessage(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: VisitorRequest,
  ) {
    const { text } = SendMessageSchema.parse(body);
    const idempotencyKey = req.headers["idempotency-key"];
    const key = Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey;
    return {
      message: await this.widget.sendMessage(id, req.visitor!, text, key, req.ip ?? null),
    };
  }

  /** Явная просьба «позвать человека» (docs/14 §2). */
  @Post("conversations/:id/handoff")
  @UseGuards(VisitorGuard)
  @HttpCode(200)
  async requestHandoff(@Param("id") id: string, @Req() req: VisitorRequest) {
    return this.widget.requestHandoff(id, req.visitor!, req.ip ?? null);
  }
}
