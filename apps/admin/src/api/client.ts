/**
 * HTTP-клиент приватной зоны /api/v1 (docs/07_API.md §3).
 * Все ответы в конверте: успех {data}, ошибка {error:{code,message,details}}.
 * Сессия — httpOnly-cookie (unichat_access), поэтому во всех запросах
 * указывается credentials:"include" (docs/15_SECURITY.md §1).
 */
import type {
  AdminConversation,
  AdminMessage,
  AdminUser,
  AddMemberInput,
  AiProviderCheckResult,
  ProjectAnalyticsDto,
  AssistantDto,
  AuthedUser,
  ConversationListResult,
  CreateRuleInput,
  CreateSiteInput,
  CreateUserInput,
  EscalationRuleDto,
  FaqDto,
  KnowledgeDocumentDto,
  MemberSummary,
  PendingHandoff,
  ProjectDetail,
  ProjectSummary,
  PublicSetting,
  SandboxAnswer,
  SiteDto,
  UpdateAssistantInput,
  UpdateFaqInput,
  UpdateRuleInput,
  UpdateSiteInput,
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

  // --- setup / визард первого входа (apps/api/src/auth/setup.controller.ts) ---

  /** POST /setup — первый владелец по одноразовому токену; сервер сам логинит (cookie). */
  setup(input: { token: string; email: string; password: string; name?: string }): Promise<{ user: AuthedUser }> {
    return this.request("POST", "/setup", {
      token: input.token,
      email: input.email,
      password: input.password,
      name: input.name ?? "",
    });
  }

  // --- проекты и участники (projects.controller.ts) ---

  createProject(name: string): Promise<{ project: ProjectDetail }> {
    return this.request("POST", "/projects", { name });
  }

  getProject(id: string): Promise<{ project: ProjectDetail }> {
    return this.request("GET", `/projects/${id}`);
  }

  renameProject(id: string, name: string): Promise<{ project: ProjectDetail }> {
    return this.request("PATCH", `/projects/${id}`, { name });
  }

  addMember(projectId: string, input: AddMemberInput): Promise<{ members: MemberSummary[] }> {
    return this.request("POST", `/projects/${projectId}/members`, input);
  }

  // --- пользователи установки (users.controller.ts) ---

  listUsers(): Promise<{ users: AdminUser[] }> {
    return this.request("GET", "/users");
  }

  createUser(input: CreateUserInput): Promise<{ user: AdminUser }> {
    return this.request("POST", "/users", {
      email: input.email,
      password: input.password,
      name: input.name ?? "",
      installation_role: input.installation_role ?? null,
    });
  }

  // --- сайты (REST sites Ф5; таблица sites — migrations/0002) ---

  listSites(projectId: string): Promise<{ sites: SiteDto[] }> {
    return this.request("GET", `/projects/${projectId}/sites`);
  }

  createSite(projectId: string, input: CreateSiteInput): Promise<{ site: SiteDto }> {
    return this.request("POST", `/projects/${projectId}/sites`, input);
  }

  updateSite(siteId: string, patch: UpdateSiteInput): Promise<{ site: SiteDto }> {
    return this.request("PATCH", `/sites/${siteId}`, patch);
  }

  /** Регенерация publishable-ключа: контракт возвращает полный {site}. */
  regenerateSiteKey(siteId: string): Promise<{ site: SiteDto }> {
    return this.request("POST", `/sites/${siteId}/regenerate-key`);
  }

  // --- ассистент (assistants.controller.ts — GET/PATCH) ---

  getAssistant(projectId: string): Promise<{ assistant: AssistantDto }> {
    return this.request("GET", `/projects/${projectId}/assistant`);
  }

  updateAssistant(projectId: string, patch: UpdateAssistantInput): Promise<{ assistant: AssistantDto }> {
    return this.request("PATCH", `/projects/${projectId}/assistant`, patch);
  }

  // --- правила эскалации (escalations.controller.ts) ---

  listRules(projectId: string): Promise<{ rules: EscalationRuleDto[] }> {
    return this.request("GET", `/projects/${projectId}/assistant/rules`);
  }

  createRule(projectId: string, input: CreateRuleInput): Promise<{ rule: EscalationRuleDto }> {
    return this.request("POST", `/projects/${projectId}/assistant/rules`, {
      priority: input.priority,
      type: input.type,
      params: input.params ?? {},
      action: input.action ?? "handoff",
      enabled: input.enabled ?? true,
    });
  }

  updateRule(projectId: string, ruleId: string, patch: UpdateRuleInput): Promise<{ rule: EscalationRuleDto }> {
    return this.request("PATCH", `/projects/${projectId}/assistant/rules/${ruleId}`, patch);
  }

  deleteRule(projectId: string, ruleId: string): Promise<{ deleted: true }> {
    return this.request("DELETE", `/projects/${projectId}/assistant/rules/${ruleId}`);
  }

  // --- знания (knowledge.controller.ts) ---

  /** Multipart-upload документа (поле file, лимит 25 МБ — docs/12 §1). */
  async uploadDocument(projectId: string, file: File): Promise<{ document: KnowledgeDocumentDto }> {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/projects/${projectId}/knowledge/documents`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
    } catch {
      throw new ApiError(0, "NETWORK", "Сеть недоступна");
    }
    const raw: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = parseErrorEnvelope(raw);
      throw new ApiError(res.status, parsed?.code ?? "HTTP_ERROR", parsed?.message ?? `HTTP ${res.status}`, parsed?.details);
    }
    if (isRecord(raw) && isRecord(raw.data)) {
      return raw.data as { document: KnowledgeDocumentDto };
    }
    throw new ApiError(res.status, "BAD_ENVELOPE", "Некорректный формат ответа сервера");
  }

  addKnowledgeUrl(projectId: string, url: string): Promise<{ document: KnowledgeDocumentDto }> {
    return this.request("POST", `/projects/${projectId}/knowledge/urls`, { url });
  }

  addKnowledgeText(projectId: string, title: string, text: string): Promise<{ document: KnowledgeDocumentDto }> {
    return this.request("POST", `/projects/${projectId}/knowledge/texts`, { title, text });
  }

  listDocuments(projectId: string): Promise<{ documents: KnowledgeDocumentDto[] }> {
    return this.request("GET", `/projects/${projectId}/knowledge/documents`);
  }

  reindexDocument(projectId: string, documentId: string): Promise<{ ok: true }> {
    return this.request("POST", `/projects/${projectId}/knowledge/documents/${documentId}/reindex`);
  }

  deleteDocument(projectId: string, documentId: string): Promise<{ ok: true }> {
    return this.request("DELETE", `/projects/${projectId}/knowledge/documents/${documentId}`);
  }

  listFaqs(projectId: string): Promise<{ faqs: FaqDto[] }> {
    return this.request("GET", `/projects/${projectId}/knowledge/faqs`);
  }

  addFaq(projectId: string, question: string, answer: string): Promise<{ faq: FaqDto }> {
    return this.request("POST", `/projects/${projectId}/knowledge/faqs`, { question, answer });
  }

  updateFaq(projectId: string, faqId: string, patch: UpdateFaqInput): Promise<{ faq: FaqDto }> {
    return this.request("PUT", `/projects/${projectId}/knowledge/faqs/${faqId}`, patch);
  }

  deleteFaq(projectId: string, faqId: string): Promise<{ ok: true }> {
    return this.request("DELETE", `/projects/${projectId}/knowledge/faqs/${faqId}`);
  }

  // --- аналитика (analytics.controller.ts: {analytics: ProjectAnalyticsDto}) ---

  getAnalytics(projectId: string, days = 14): Promise<{ analytics: ProjectAnalyticsDto }> {
    return this.request("GET", `/projects/${projectId}/analytics?days=${days}`);
  }

  // --- песочница (новый endpoint Ф5) ---

  sendSandboxMessage(projectId: string, text: string): Promise<{ answer: SandboxAnswer }> {
    return this.request("POST", `/projects/${projectId}/sandbox/messages`, { text });
  }

  // --- настройки установки (settings.controller.ts) ---

  listSettings(): Promise<{ settings: PublicSetting[] }> {
    return this.request("GET", "/settings");
  }

  putSetting(key: string, value: unknown, isSecret = false): Promise<{ ok: true }> {
    return this.request("PUT", `/settings/${key}`, { value, is_secret: isSecret });
  }

  /** POST /settings/ai-provider/check — «Проверить соединение» (docs/22 §3). */
  checkAiProvider(): Promise<AiProviderCheckResult> {
    return this.request("POST", "/settings/ai-provider/check");
  }
}
