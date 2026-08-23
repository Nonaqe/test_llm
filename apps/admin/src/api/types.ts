/**
 * Локальные контракты Admin-API (Фаза 4 inbox + Фаза 5 полная панель, docs/30 §Ф5).
 * По заданию типы определены локально; формы совпадают с ответами сервера
 * (конверт {data:...} / {error:{code,message,details}}, docs/07_API.md §1, §5).
 */

export type ConversationStateValue =
  | "NEW"
  | "AI_ACTIVE"
  | "WAITING_OPERATOR"
  | "OPERATOR_ACTIVE"
  | "RESOLVED"
  | "CLOSED";

export type HandoffReasonValue =
  | "explicit_request"
  | "low_confidence"
  | "keyword"
  | "intent"
  | "complaint"
  | "no_answer"
  | "manual";

export type MessageRoleValue = "visitor" | "assistant" | "operator" | "system" | "note";

/** Цитата источника AI-ответа (docs/11 §5). */
export interface MessageCitation {
  chunk_id: string;
  score: number;
}

/** Причина передачи диалога оператору (docs/14_ESCALATION_RULES.md). */
export interface AdminHandoff {
  id: string;
  reason: HandoffReasonValue;
  requested_by: string;
  rule_id: string | null;
  created_at: string;
}

/** Карточка диалога для inbox (docs/13_OPERATOR_PANEL.md §2). */
export interface AdminConversation {
  id: string;
  project_id: string;
  site_id: string;
  state: ConversationStateValue;
  assigned_operator_id: string | null;
  last_seq: number;
  last_message_at: string | null;
  created_at: string;
  handoff: AdminHandoff | null;
}

/** Полное сообщение панели: включая role=note (заметки команды, docs/13 §3). */
export interface AdminMessage {
  id: string;
  conversation_id: string;
  seq: number;
  role: MessageRoleValue;
  content: string;
  created_at: string;
  citations?: MessageCitation[];
  confidence?: number;
}

/** Элемент очереди ожидающих handoff (GET /handoffs?status=pending). */
export interface PendingHandoff extends AdminHandoff {
  conversation_id: string;
  project_id: string;
  conversation_state: ConversationStateValue;
}

/** Профиль пользователя из /auth/login и /auth/me. */
export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  installation_role: string | null;
}

/** Проект из GET /projects (фактическая форма ProjectsRepo.list). */
export interface ProjectSummary {
  id: string;
  name: string;
  created_at?: string;
}

/** Участник проекта из GET /projects/:id/members. */
export interface MemberSummary {
  user_id: string;
  email: string;
  name: string;
  project_role: string;
}

/** Ответ GET /projects/:id/conversations. */
export interface ConversationListResult {
  conversations: AdminConversation[];
  next_cursor: string | null;
}

// --- События Socket.IO, namespace /admin (docs/07_API.md §4.2) ---

export interface AdminClientToServerEvents {
  "admin:subscribe_project": (
    payload: { project_id: string },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  "admin:unsubscribe_project": (payload: { project_id: string }) => void;
  /** Пульс оператора (TTL 60 c, admin.gateway): поддерживает «операторы онлайн» */
  "presence:heartbeat": (payload: { project_id: string }) => void;
}

export interface AdminServerToClientEvents {
  "conversation:created": (payload: { conversation: AdminConversation }) => void;
  "conversation:state_changed": (payload: {
    conversation_id: string;
    project_id: string;
    state: ConversationStateValue;
  }) => void;
  message: (message: AdminMessage) => void;
  "handoff:created": (payload: {
    conversation_id: string;
    project_id: string;
    handoff_id: string;
    reason: HandoffReasonValue;
  }) => void;
  "queue:updated": (payload: { project_id: string }) => void;
  "operator:presence": (payload: { project_id: string; online_count: number }) => void;
}

// ===========================================================================
// Фаза 5 — полная админ-панель (docs/30 §Ф5, docs/22_ADMIN_GUIDE.md)
// Контракты сверены с контроллерами apps/api/src (источник истины).
// Endpoints sites/analytics/sandbox добавляются параллельно на бэкенде —
// страницы деградируют в пустое состояние при 404.
// ===========================================================================

// --- Пользователи установки (apps/api/src/users/users.controller.ts) ---

/** Строка GET /users (UsersRepo.listAll) и ответ POST /users. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  installation_role: string | null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
  installation_role?: "owner" | "admin" | null;
}

// --- Проекты (apps/api/src/projects/projects.controller.ts) ---

export interface ProjectDetail {
  id: string;
  name: string;
  created_at?: string;
}

export interface AddMemberInput {
  user_id?: string;
  email?: string;
  project_role: "project_admin" | "operator";
}

// --- Сайты (REST sites: GET/POST /projects/:id/sites, PATCH /sites/:sid,
// POST /sites/:sid/regenerate-key; таблица sites — apps/api/migrations/0002) ---

/** WidgetConfig из packages/shared/src/index.ts (+ расширения без ломки контракта). */
export interface SiteWidgetConfig {
  locale?: string;
  theme?: {
    accent?: string;
    position?: "right" | "left";
  };
  greeting?: string;
}

export interface SiteDto {
  id: string;
  project_id: string;
  name: string;
  domain: string;
  allowed_origins: string[];
  widget_public_key: string;
  widget_config: SiteWidgetConfig;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSiteInput {
  name: string;
  domain: string;
  allowed_origins?: string[];
  widget_config?: SiteWidgetConfig;
}

export interface UpdateSiteInput {
  name?: string;
  domain?: string;
  allowed_origins?: string[];
  widget_config?: SiteWidgetConfig;
  is_active?: boolean;
}

// --- Ассистент (apps/api/src/assistants/assistants.controller.ts, AssistantsRepo) ---

export interface AssistantDto {
  id: string;
  project_id: string;
  name: string;
  locale: string;
  tone: string;
  company_description: string;
  custom_instructions: string;
  retrieval_settings: {
    top_k?: number;
    score_threshold?: number;
    history_depth?: number;
  };
  safety_settings: {
    denied_topics?: string[];
    fallback_message?: string;
  };
  widget_texts: { greeting?: string };
}

export interface UpdateAssistantInput {
  name?: string;
  locale?: string;
  tone?: string;
  company_description?: string;
  custom_instructions?: string;
  retrieval_settings?: {
    top_k?: number;
    score_threshold?: number;
    history_depth?: number;
  };
  safety_settings?: {
    denied_topics?: string[];
    fallback_message?: string;
  };
  widget_texts?: { greeting?: string };
}

// --- Правила эскалации (apps/api/src/escalations/escalations.controller.ts) ---

export type EscalationRuleTypeValue =
  | "explicit_request"
  | "low_confidence"
  | "keyword"
  | "intent"
  | "complaint"
  | "no_answer";

export type EscalationActionValue = "handoff" | "fallback_message";

/** EscalationRuleDto из packages/shared/src/index.ts. */
export interface EscalationRuleDto {
  id: string;
  assistant_id: string;
  priority: number;
  type: EscalationRuleTypeValue;
  params: Record<string, unknown>;
  action: EscalationActionValue;
  enabled: boolean;
}

export interface CreateRuleInput {
  priority: number;
  type: EscalationRuleTypeValue;
  params?: Record<string, unknown>;
  action?: EscalationActionValue;
  enabled?: boolean;
}

export interface UpdateRuleInput {
  priority?: number;
  type?: EscalationRuleTypeValue;
  params?: Record<string, unknown>;
  action?: EscalationActionValue;
  enabled?: boolean;
}

// --- Знания (apps/api/src/knowledge/knowledge.controller.ts, DocumentsRepo) ---

export type DocumentStatusValue = "pending" | "parsing" | "indexing" | "ready" | "failed";

export interface KnowledgeDocumentDto {
  id: string;
  project_id: string;
  source_type: "upload" | "url" | "text";
  title: string;
  mime: string | null;
  size_bytes: number | null;
  status: DocumentStatusValue;
  error: string | null;
  version: number;
}

export interface FaqDto {
  id: string;
  project_id: string;
  question: string;
  answer: string;
  enabled: boolean;
}

export interface UpdateFaqInput {
  question?: string;
  answer?: string;
  enabled?: boolean;
}

// --- Аналитика (GET /projects/:id/analytics?days=N — apps/api/src/projects/
// analytics.controller.ts + analytics.repo.ts; DTO = ProjectAnalyticsDto из
// packages/shared) ---

export interface AnalyticsDayPoint {
  /** YYYY-MM-DD */
  date: string;
  conversations: number;
  messages: number;
  handoffs: number;
}

export interface AnalyticsLowRelevanceItem {
  text: string;
  count: number;
}

export interface ProjectAnalyticsDto {
  days: AnalyticsDayPoint[];
  totals: {
    conversations: number;
    handoffs: number;
    /** handoffs/conversations; null при нулевом числе диалогов. */
    handoff_rate: number | null;
    /** Доля диалогов без записей handoffs; null при нулевом числе диалогов. */
    ai_resolved_share: number | null;
    /** Среднее время первого ответа ассистента, мс; null если данных нет. */
    avg_first_response_ms: number | null;
  };
  low_relevance_top: AnalyticsLowRelevanceItem[];
}

// --- Песочница (POST /projects/:id/sandbox/messages {text} → {answer};
// SandboxAnswerDto из packages/shared — поля обязательны, confidence null на
// fallback-ходе) ---

export interface SandboxAnswer {
  text: string;
  citations: Array<{ chunk_id: string; score: number }>;
  /** Самооценка LLM 0..1; null на fallback-ходе (LLM не вызывался). */
  confidence: number | null;
  fallback: boolean;
}

// --- Настройки установки (apps/api/src/settings/settings.controller.ts) ---

export interface PublicSetting {
  key: string;
  is_secret: boolean;
  /** Для секретов значение маскируется ({masked:true}) — docs/15 §3. */
  value: unknown;
}

export interface AiProviderCheckResult {
  ok: boolean;
  kind?: string;
  error?: string;
}

// --- Диагностика (Фаза 7, docs/30 §Ф7; GET /diagnostics, POST /diagnostics/backup) ---

/** Статус компонента установки для страницы диагностики. */
export type ComponentStatusValue = "ok" | "error" | "not_configured";

/** Последний бэкап прошёл успешно: метаданные дампов. */
export interface LastBackupOk {
  ok: true;
  at_iso: string;
  dump_file: string;
  uploads_file: string | null;
  size_bytes: number;
}

/** Последний бэкап завершился ошибкой (текст от backup-сервиса). */
export interface LastBackupError {
  ok: false;
  error: string;
}

/** Union по полю ok: успешный бэкап несёт метаданные, неуспешный — error. */
export type LastBackupInfo = LastBackupOk | LastBackupError;

/** GET /diagnostics — сводка состояния установки (docs/30 §Ф7). */
export interface DiagnosticsDto {
  version: string;
  node: string;
  uptime_s: number;
  db: ComponentStatusValue;
  redis: ComponentStatusValue;
  /** kind настроенного AI-провайдера; null — провайдер не настроен. */
  provider_kind: string | null;
  last_backup: LastBackupInfo | null;
}
