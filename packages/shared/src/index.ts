/**
 * @uni-chat/shared — контракты домена: единый источник типов для api/admin/widget.
 * Правила зависимостей: docs/04_FOLDER_STRUCTURE.md §4 (пакет ни от чего не зависит).
 */

// --- Диалоги (docs/13_OPERATOR_PANEL.md §1) ---

export enum ConversationState {
  New = "NEW",
  AiActive = "AI_ACTIVE",
  WaitingOperator = "WAITING_OPERATOR",
  OperatorActive = "OPERATOR_ACTIVE",
  Resolved = "RESOLVED",
  Closed = "CLOSED",
}

export enum MessageRole {
  Visitor = "visitor",
  Assistant = "assistant",
  Operator = "operator",
  System = "system",
  Note = "note",
}

// --- Handoff (docs/14_ESCALATION_RULES.md) ---

export enum HandoffReason {
  ExplicitRequest = "explicit_request",
  LowConfidence = "low_confidence",
  Keyword = "keyword",
  Intent = "intent",
  Complaint = "complaint",
  NoAnswer = "no_answer",
  Manual = "manual",
}

export enum HandoffStatus {
  Pending = "pending",
  Accepted = "accepted",
  Resolved = "resolved",
  Cancelled = "cancelled",
}

export enum HandoffRequestedBy {
  Ai = "ai",
  Visitor = "visitor",
  Operator = "operator",
}

// --- Правила эскалации (docs/14_ESCALATION_RULES.md §3) ---

export enum EscalationRuleType {
  ExplicitRequest = "explicit_request",
  LowConfidence = "low_confidence",
  Keyword = "keyword",
  Intent = "intent",
  Complaint = "complaint",
  NoAnswer = "no_answer",
}

export enum EscalationAction {
  Handoff = "handoff",
  FallbackMessage = "fallback_message",
}

export interface EscalationRuleDto {
  id: string;
  assistant_id: string;
  priority: number;
  type: EscalationRuleType;
  params: Record<string, unknown>;
  action: EscalationAction;
  enabled: boolean;
}

// --- Роли (docs/15_SECURITY.md §2) ---

export enum InstallationRole {
  Owner = "owner",
  Admin = "admin",
}

export enum ProjectRole {
  ProjectAdmin = "project_admin",
  Operator = "operator",
}

// --- Knowledge Base (docs/12_KNOWLEDGE_BASE.md §2) ---

export enum DocumentStatus {
  Pending = "pending",
  Parsing = "parsing",
  Indexing = "indexing",
  Ready = "ready",
  Failed = "failed",
}

export enum KnowledgeSourceType {
  Upload = "upload",
  Url = "url",
  Faq = "faq",
  Text = "text",
}

// --- Общие контракты API (docs/07_API.md §1) ---

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface HealthResponse {
  status: "ok";
  version: string;
  uptime_s: number;
}

export interface ReadinessResponse {
  status: "ok" | "degraded";
  checks: {
    database: "ok" | "error" | "not_configured" | "not_checked_yet";
  };
}

// --- Публичная зона виджета /widget/v1 (docs/07 §2) ---

export interface WidgetTheme {
  accent?: string;
  position?: "right" | "left";
}

export interface WidgetConfig {
  locale: string;
  theme: WidgetTheme;
  greeting: string;
}

export interface WidgetMessageCitation {
  chunk_id: string;
  score: number;
}

export interface WidgetMessageDto {
  id: string;
  conversation_id: string;
  seq: number;
  role: "visitor" | "assistant" | "operator" | "system";
  content: string;
  created_at: string;
  /** Цитаты источников AI-ответа (docs/11 §5) */
  citations?: WidgetMessageCitation[];
  /** Самооценка уверенности AI (docs/11 §4) */
  confidence?: number;
}

export interface WidgetConversationDto {
  id: string;
  state: ConversationState;
  last_seq: number;
}

export interface WidgetInitResponse {
  visitor_token: string;
  widget: WidgetConfig;
  conversation: WidgetConversationDto | null;
}

// --- Приватная зона админки /api/v1 (docs/07 §3) ---

/** Карточка диалога для inbox (docs/13 §2): причина handoff видна оператору. */
export interface AdminHandoffDto {
  id: string;
  reason: HandoffReason;
  requested_by: HandoffRequestedBy;
  rule_id: string | null;
  created_at: string;
}

export interface AdminConversationDto {
  id: string;
  project_id: string;
  site_id: string;
  state: ConversationState;
  assigned_operator_id: string | null;
  last_seq: number;
  last_message_at: string | null;
  created_at: string;
  handoff: AdminHandoffDto | null;
}

/** Полное сообщение для панели: включая role=note (заметки команды). */
export interface AdminMessageDto {
  id: string;
  conversation_id: string;
  seq: number;
  role: MessageRole;
  content: string;
  created_at: string;
  citations?: WidgetMessageCitation[];
  confidence?: number;
}

export interface AdminConversationListResponse {
  conversations: AdminConversationDto[];
  next_cursor: string | null;
}

export interface AdminPendingHandoffDto extends AdminHandoffDto {
  conversation_id: string;
  project_id: string;
  conversation_state: ConversationState;
}

// --- События Socket.IO, namespace /admin (docs/07 §4.2) ---

export interface AdminClientToServerEvents {
  "admin:subscribe_project": (
    payload: { project_id: string },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  "admin:unsubscribe_project": (payload: { project_id: string }) => void;
  /** Heartbeat presence оператора (TTL на сервере — docs/13 §5) */
  "presence:heartbeat": (payload: { project_id: string }) => void;
  "admin:typing": (payload: { conversation_id: string }) => void;
}

export interface AdminServerToClientEvents {
  "conversation:created": (payload: { conversation: AdminConversationDto }) => void;
  "conversation:state_changed": (payload: {
    conversation_id: string;
    project_id: string;
    state: ConversationState;
  }) => void;
  message: (message: AdminMessageDto) => void;
  "handoff:created": (payload: {
    conversation_id: string;
    project_id: string;
    handoff_id: string;
    reason: HandoffReason;
  }) => void;
  "queue:updated": (payload: { project_id: string }) => void;
  "operator:presence": (payload: { project_id: string; online_count: number }) => void;
  /** Релей typing посетителя операторам (расширение контракта — docs/07 §7) */
  "visitor:typing": (payload: { conversation_id: string; project_id: string }) => void;
}

export interface WidgetClientToServerEvents {
  "widget:join": (
    payload: { conversation_id: string },
    ack?: (result: { ok: boolean; error?: string }) => void,
  ) => void;
  "widget:typing:start": (payload: { conversation_id: string }) => void;
  "widget:typing:stop": (payload: { conversation_id: string }) => void;
}

export interface WidgetServerToClientEvents {
  message: (message: WidgetMessageDto) => void;
  "conversation:state": (payload: {
    conversation_id: string;
    state: ConversationState;
  }) => void;
  /** Частичный токен стрима AI (не персистится; docs/07 §4.1) */
  ai_token: (payload: { token: string }) => void;
  /** Есть ли операторы онлайн у проекта диалога (docs/07 §4.1, docs/13 §5) */
  "presence:operators": (payload: { online: boolean }) => void;
  /** Оператор набирает ответ (TTL 5 с на сервере) */
  "operator:typing": () => void;
}
