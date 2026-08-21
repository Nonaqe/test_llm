/**
 * HTTP-клиент приватной зоны /api/v1 (docs/07_API.md §3).
 * Все ответы в конверте: успех {data}, ошибка {error:{code,message,details}}.
 * Сессия — httpOnly-cookie (unichat_access), поэтому во всех запросах
 * указывается credentials:"include" (docs/15_SECURITY.md §1).
 */
import type {
  AdminConversation,
  AdminMessage,
  AuthedUser,
  ConversationListResult,
  MemberSummary,
  PendingHandoff,
  ProjectSummary,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelopeBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Сужение неизвестного тела ответа до конверта ошибки {error:{...}}. */
function parseErrorEnvelope(raw: unknown): ErrorEnvelopeBody | null {
  if (!isRecord(raw) || !isRecord(raw.error)) return null;
  const err = raw.error;
  return {
    code: typeof err.code === "string" ? err.code : "HTTP_ERROR",
    message: typeof err.message === "string" ? err.message : "Ошибка запроса",
    details: isRecord(err.details) ? err.details : undefined,
  };
}

export type ConversationAction = "accept" | "return-to-ai" | "close" | "reopen";

export class AdminApi {
  private readonly baseUrl: string;

  constructor(baseUrl = "/api/v1") {
    this.baseUrl = baseUrl;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        credentials: "include",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "NETWORK", "Сеть недоступна");
    }

    const raw: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const parsed = parseErrorEnvelope(raw);
      throw new ApiError(
        res.status,
        parsed?.code ?? "HTTP_ERROR",
        parsed?.message ?? `HTTP ${res.status}`,
        parsed?.details,
      );
    }

    // Успешный конверт {data: ...}; пустое тело трактруем как data:null.
    if (isRecord(raw) && "data" in raw) {
      return raw.data as T;
    }
    throw new ApiError(res.status, "BAD_ENVELOPE", "Некорректный формат ответа сервера");
  }

  // --- auth ---

  login(email: string, password: string): Promise<{ user: AuthedUser }> {
    return this.request("POST", "/auth/login", { email, password });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request("POST", "/auth/logout");
  }

  me(): Promise<{ user: AuthedUser }> {
    return this.request("GET", "/auth/me");
  }

  // --- проекты и участники ---

  listProjects(): Promise<{ projects: ProjectSummary[] }> {
    return this.request("GET", "/projects");
  }

  listMembers(projectId: string): Promise<{ members: MemberSummary[] }> {
    return this.request("GET", `/projects/${projectId}/members`);
  }

  // --- inbox (Фаза 4) ---

  /** GET /handoffs?status=pending — фильтр по проекту выполняется на клиенте. */
  listPendingHandoffs(): Promise<{ handoffs: PendingHandoff[] }> {
    return this.request("GET", "/handoffs?status=pending");
  }

  listConversations(
    projectId: string,
    params: { states?: readonly string[] | null; limit?: number; cursor?: string | null } = {},
  ): Promise<ConversationListResult> {
    const query = new URLSearchParams();
    if (params.states != null && params.states.length > 0) {
      query.set("state", params.states.join(","));
    }
    query.set("limit", String(params.limit ?? 50));
    if (params.cursor) query.set("cursor", params.cursor);
    const qs = query.toString();
    return this.request("GET", `/projects/${projectId}/conversations${qs === "" ? "" : `?${qs}`}`);
  }

  getConversation(id: string): Promise<{ conversation: AdminConversation }> {
    return this.request("GET", `/conversations/${id}`);
  }

  listMessages(id: string): Promise<{ messages: AdminMessage[] }> {
    return this.request("GET", `/conversations/${id}/messages`);
  }

  sendMessage(id: string, text: string, isNote: boolean): Promise<{ message: AdminMessage }> {
    const body: { text: string; is_note?: boolean } = { text };
    if (isNote) body.is_note = true;
    return this.request("POST", `/conversations/${id}/messages`, body);
  }

  action(id: string, action: ConversationAction): Promise<{ conversation: AdminConversation }> {
    return this.request("POST", `/conversations/${id}/${action}`);
  }

  assign(id: string, userId: string): Promise<{ conversation: AdminConversation }> {
    return this.request("POST", `/conversations/${id}/assign`, { user_id: userId });
  }
}
