/**
 * REST-клиент публичной зоны /widget/v1 (docs/07 §2).
 * Все ответы приходят в конверте {data}; ошибки — {error:{code,message,details}}.
 */
import type { WidgetConfig, WidgetConversationDto, WidgetInitResponse, WidgetMessageDto } from "@uni-chat/shared";

export interface WidgetApiError {
  code: string;
  message: string;
  details?: { retry_after_s?: number };
  status: number;
}

export class WidgetApi {
  constructor(private readonly baseUrl: string) {}

  async init(params: {
    key: string;
    origin: string;
    anon_id: string;
    attributes?: Record<string, unknown>;
  }): Promise<WidgetInitResponse> {
    return this.request<WidgetInitResponse>("POST", "/widget/v1/init", params);
  }

  async createConversation(token: string): Promise<WidgetConversationDto> {
    const res = await this.request<{ conversation: WidgetConversationDto }>(
      "POST",
      "/widget/v1/conversations",
      undefined,
      token,
    );
    return res.conversation;
  }

  async listMessages(
    token: string,
    conversationId: string,
    afterSeq: number,
  ): Promise<WidgetMessageDto[]> {
    const res = await this.request<{ messages: WidgetMessageDto[] }>(
      "GET",
      `/widget/v1/conversations/${conversationId}/messages?after_seq=${afterSeq}`,
      undefined,
      token,
    );
    return res.messages ?? [];
  }

  async sendMessage(
    token: string,
    conversationId: string,
    text: string,
    idempotencyKey: string,
  ): Promise<WidgetMessageDto> {
    const res = await this.request<{ message: WidgetMessageDto }>(
      "POST",
      `/widget/v1/conversations/${conversationId}/messages`,
      { text },
      token,
      { "Idempotency-Key": idempotencyKey },
    );
    return res.message;
  }

  async requestHandoff(token: string, conversationId: string): Promise<void> {
    await this.request("POST", `/widget/v1/conversations/${conversationId}/handoff`, undefined, token);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as
      | { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> } }
      | null;
    if (!res.ok || !json || json.error) {
      const err: WidgetApiError = {
        status: res.status,
        code: json?.error?.code ?? "NETWORK",
        message: json?.error?.message ?? "Сеть недоступна",
        details: json?.error?.details as WidgetApiError["details"],
      };
      throw err;
    }
    return json.data as T;
  }
}

export type { WidgetConfig };
