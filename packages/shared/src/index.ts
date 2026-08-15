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

export interface WidgetMessageDto {
  id: string;
  conversation_id: string;
  seq: number;
  role: "visitor" | "assistant" | "operator" | "system";
  content: string;
  created_at: string;
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

// --- События Socket.IO, namespace /widget (docs/07 §4.1) ---

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
}
