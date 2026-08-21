/**
 * Локальные контракты Admin-API для прототипа inbox (Фаза 4, docs/30 «Admin-часть inbox»).
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
