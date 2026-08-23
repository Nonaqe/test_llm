/**
 * Панель оператора (inbox) — функциональность прототипа Фазы 4, перенесена
 * на маршруты Ф5 без изменений поведения (docs/13_OPERATOR_PANEL.md §2–3).
 *
 * Экран: вкладки очередей → список диалогов → транскрипт + ответ оператора
 * (в т.ч. внутренняя заметка) + действия по состоянию. Проект выбирается
 * глобальным переключателем в шапке (Layout). Realtime /admin — за флагом.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { ADMIN_SOCKET_ENABLED, connectAdminSocket, type AdminSocket } from "../api/socket";
import type {
  AdminConversation,
  AdminMessage,
  MemberSummary,
} from "../api/types";
import { describeApiError, formatTime } from "../format";
import { useT } from "../i18n";
import { api, useAuth } from "../state/auth";
import { useProjects } from "../state/projects";

// --- Вкладки очередей (docs/13 §2) ---

type TabKey = "new" | "waiting" | "active" | "mine" | "closed";

/** null = запрашиваем все состояния проекта (вкладка «Мои» фильтруется на клиенте). */
const TAB_STATES: Record<TabKey, readonly string[] | null> = {
  new: ["NEW", "AI_ACTIVE"],
  waiting: ["WAITING_OPERATOR"],
  active: ["OPERATOR_ACTIVE"],
  mine: null,
  closed: ["RESOLVED", "CLOSED"],
};

const TAB_ORDER: readonly TabKey[] = ["new", "waiting", "active", "mine", "closed"];

const TAB_I18N: Record<TabKey, string> = {
  new: "inbox.tab.new",
  waiting: "inbox.tab.waiting",
  active: "inbox.tab.active",
  mine: "inbox.tab.mine",
  closed: "inbox.tab.closed",
};

interface ToastItem {
  id: number;
  text: string;
}

export function InboxPage() {
  const { t } = useT();
  const auth = useAuth();
  const user = auth.user;
  const projects = useProjects();
  const projectId = projects.currentId;

  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [tab, setTab] = useState<TabKey>("new");

  const [conversations, setConversations] = useState<AdminConversation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [pendingCount, setPendingCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<AdminConversation | null>(null);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [isNote, setIsNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState("");

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback((text: string) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((prev) => [...prev, { id, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  /** 401 в любом запросе → сессия истекла, редирект на логин. */
  const handleMaybeExpired = useCallback(
    (err: unknown) => {
      auth.onApiError(err);
    },
    [auth],
  );

  // Список диалогов текущего проекта и вкладки (+ курсорная догрузка).
  const loadConversations = useCallback(
    async (opts: { append?: boolean; cursor?: string | null } = {}) => {
      if (projectId === null) return;
      setListLoading(true);
      setListError(null);
      try {
        const res = await api.listConversations(projectId, {
          states: TAB_STATES[tab],
          limit: 50,
          cursor: opts.cursor ?? null,
        });
        let items = res.conversations;
        if (tab === "mine" && user !== null) {
          items = items.filter((c) => c.assigned_operator_id === user.id);
        }
        setConversations((prev) => (opts.append === true ? [...prev, ...items] : items));
        setNextCursor(res.next_cursor);
      } catch (err) {
        handleMaybeExpired(err);
        setListError(describeApiError(err));
      } finally {
        setListLoading(false);
      }
    },
    [projectId, tab, user, handleMaybeExpired],
  );

  // Бейдж ожидающих handoff по текущему проекту (фильтр на клиенте).
  const loadPendingHandoffs = useCallback(async () => {
    try {
      const res = await api.listPendingHandoffs();
      setPendingCount(
        projectId === null ? 0 : res.handoffs.filter((h) => h.project_id === projectId).length,
      );
    } catch (err) {
      handleMaybeExpired(err);
    }
  }, [projectId, handleMaybeExpired]);

  // Участники проекта — для назначения диалога.
  useEffect(() => {
    if (projectId === null) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    api
      .listMembers(projectId)
      .then((res) => {
        if (!cancelled) setMembers(res.members);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status !== 403) handleMaybeExpired(err);
        // 403 (не ManageProject) — оператору назначение недоступно, молча
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, handleMaybeExpired]);

  // Смена проекта/вкладки: сброс выбора и перезагрузка списка.
  useEffect(() => {
    setSelectedId(null);
    void loadConversations();
    void loadPendingHandoffs();
  }, [loadConversations, loadPendingHandoffs]);

  // Транскрипт выбранного диалога.
  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const [convRes, msgRes] = await Promise.all([
          api.getConversation(id),
          api.listMessages(id),
        ]);
        setConversation(convRes.conversation);
        setMessages(msgRes.messages);
      } catch (err) {
        handleMaybeExpired(err);
        setDetailError(describeApiError(err));
      } finally {
        setDetailLoading(false);
      }
    },
    [handleMaybeExpired],
  );

  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setActionError(null);
    setDraft("");
    setIsNote(false);
    setAssigneeId("");
    if (selectedId !== null) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const refreshSelectedMeta = useCallback(async () => {
    if (selectedId === null) return;
    try {
      const res = await api.getConversation(selectedId);
      setConversation(res.conversation);
    } catch (err) {
      handleMaybeExpired(err);
    }
  }, [selectedId, handleMaybeExpired]);

  // Автопрокрутка транскрипта вниз.
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (): Promise<void> => {
    if (selectedId === null || sending) return;
    const text = draft.trim();
    if (text === "") return;
    setSending(true);
    setActionError(null);
    try {
      const res = await api.sendMessage(selectedId, text, isNote);
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
      );
      setDraft("");
      setIsNote(false);
      void loadConversations();
      void refreshSelectedMeta();
    } catch (err) {
      handleMaybeExpired(err);
      setActionError(describeApiError(err));
    } finally {
      setSending(false);
    }
  };

  const runAction = async (action: "accept" | "return-to-ai" | "close" | "reopen"): Promise<void> => {
    if (selectedId === null || acting) return;
    setActing(true);
    setActionError(null);
    try {
      const res = await api.action(selectedId, action);
      setConversation(res.conversation);
      void loadConversations();
      void loadPendingHandoffs();
    } catch (err) {
      handleMaybeExpired(err);
      setActionError(describeApiError(err));
    } finally {
      setActing(false);
    }
  };

  const assign = async (): Promise<void> => {
    if (selectedId === null || assigneeId === "" || acting) return;
    setActing(true);
    setActionError(null);
    try {
      const res = await api.assign(selectedId, assigneeId);
      setConversation(res.conversation);
      void loadConversations();
    } catch (err) {
      handleMaybeExpired(err);
      setActionError(describeApiError(err));
    } finally {
      setActing(false);
    }
  };

  // Сортировка: FIFO «ждёт дольше всех» для очереди ожидания (docs/13 §2),
  // свежие сверху — для остальных вкладок.
  const sortedConversations = useMemo(() => {
    const items = [...conversations];
    const waitingSince = (c: AdminConversation): string => c.handoff?.created_at ?? c.created_at;
    const lastAt = (c: AdminConversation): string => c.last_message_at ?? c.created_at;
    if (tab === "waiting") items.sort((a, b) => waitingSince(a).localeCompare(waitingSince(b)));
    else items.sort((a, b) => lastAt(b).localeCompare(lastAt(a)));
    return items;
  }, [conversations, tab]);

  const memberName = useCallback(
    (userId: string): string => {
      const found = members.find((m) => m.user_id === userId);
      return found !== undefined ? found.name || found.email : `#${userId.slice(0, 8)}`;
    },
    [members],
  );

  // Кнопки действий по состоянию (docs/13 §1, §3).
  const state = conversation?.state ?? null;
  const canAccept = state === "WAITING_OPERATOR";
  const canReturnToAi =
    state === "OPERATOR_ACTIVE" || state === "WAITING_OPERATOR" || state === "AI_ACTIVE";
  const canClose = canReturnToAi;
  const canReopen = state === "RESOLVED" || state === "CLOSED";
  const canAssign = state === "OPERATOR_ACTIVE";

  // --- Realtime /admin (docs/07 §4.2) ---
  // Подключение по httpOnly-cookie (withCredentials): сервер принимает JWT
  // из cookie handshake — токен из тела login не нужен.
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  // Сокет и таймер typing — вне эффекта: релей «оператор набирает…» из onChange
  const socketRef = useRef<AdminSocket | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ADMIN_SOCKET_ENABLED) return;

    const socket: AdminSocket = connectAdminSocket();
    socketRef.current = socket;
    const refreshAll = (): void => {
      void loadConversations();
      void loadPendingHandoffs();
    };

    socket.on("connect", () => {
      const pid = projectIdRef.current;
      if (pid !== null) {
        socket.emit("admin:subscribe_project", { project_id: pid });
        // presence:heartbeat (TTL 60 c): без него «операторы онлайн» обнулялись
        socket.emit("presence:heartbeat", { project_id: pid });
      }
    });
    // Пульс каждые 30 c, пока оператор на странице инбокса
    const heartbeat = setInterval(() => {
      const pid = projectIdRef.current;
      if (pid !== null) socket.emit("presence:heartbeat", { project_id: pid });
    }, 30_000);
    socket.on("conversation:created", (payload) => {
      if (payload.conversation.project_id !== projectIdRef.current) return;
      pushToast(t("toast.newConversation"));
      refreshAll();
    });
    socket.on("conversation:state_changed", (payload) => {
      if (payload.project_id !== projectIdRef.current) return;
      pushToast(payload.state === "WAITING_OPERATOR" ? t("toast.handoff") : t("toast.stateChanged"));
      refreshAll();
      if (payload.conversation_id === selectedIdRef.current) void loadDetail(payload.conversation_id);
    });
    socket.on("message", (message) => {
      refreshAll();
      if (message.conversation_id === selectedIdRef.current) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }
    });
    socket.on("handoff:created", (payload) => {
      if (payload.project_id !== projectIdRef.current) return;
      pushToast(t("toast.handoff"));
      void loadPendingHandoffs();
      refreshAll();
    });
    socket.on("queue:updated", (payload) => {
      if (payload.project_id !== projectIdRef.current) return;
      refreshAll();
    });
    socket.on("operator:presence", (payload) => {
      if (payload.project_id !== projectIdRef.current) return;
      setOnlineCount(payload.online_count);
    });

    return () => {
      clearInterval(heartbeat);
      socketRef.current = null;
      socket.disconnect();
    };
  }, [loadConversations, loadPendingHandoffs, loadDetail, pushToast, t]);

  if (projectId === null) {
    return (
      <div className="page-card">
        <p className="muted center pad">
          {projects.error ?? t("project.none")}
        </p>
      </div>
    );
  }

  return (
    <div className="inbox">
      <nav className="tabs" aria-label={t("nav.inbox")}>
        {TAB_ORDER.map((key) => (
          <button key={key} className={`tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
            {t(TAB_I18N[key])}
            {key === "waiting" && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="btn"
          disabled={listLoading}
          onClick={() => {
            void loadConversations();
            void loadPendingHandoffs();
          }}
        >
          {t("common.refresh")}
        </button>
        {onlineCount !== null && <span className="presence">{t("inbox.presence", { params: { count: onlineCount } })}</span>}
      </nav>

      <div className="workspace">
        <aside className="conv-list">
          {listError !== null && <p className="error-text pad">{listError}</p>}
          {listLoading && conversations.length === 0 && listError === null && (
            <p className="muted pad">{t("common.loading")}</p>
          )}
          {!listLoading && listError === null && sortedConversations.length === 0 && (
            <p className="muted pad">{t("inbox.noConversations")}</p>
          )}
          {sortedConversations.map((c) => (
            <button
              key={c.id}
              className={`conv-card${selectedId === c.id ? " selected" : ""}`}
              onClick={() => setSelectedId(c.id)}
            >
              <span className="conv-top">
                <span className="conv-id">#{c.id.slice(0, 8)}</span>
                <span className="conv-time">{formatTime(c.last_message_at ?? c.created_at)}</span>
              </span>
              <span className="conv-mid">
                <span className={`chip st-${c.state}`}>{t(`state.${c.state}`, { fallback: c.state })}</span>
                {c.handoff !== null && (
                  <span className="chip reason">{t(`reason.${c.handoff.reason}`, { fallback: c.handoff.reason })}</span>
                )}
                {c.assigned_operator_id !== null && tab !== "mine" && (
                  <span className="chip">{memberName(c.assigned_operator_id)}</span>
                )}
              </span>
            </button>
          ))}
          {nextCursor !== null && (
            <button
              className="btn wide"
              disabled={listLoading}
              onClick={() => {
                void loadConversations({ append: true, cursor: nextCursor });
              }}
            >
              {t("common.loadMore")}
            </button>
          )}
        </aside>

        <section className="dialog">
          {selectedId === null && <p className="muted center">{t("inbox.pickConversation")}</p>}
          {selectedId !== null && detailLoading && conversation === null && (
            <p className="muted center">{t("inbox.loadingConversation")}</p>
          )}
          {selectedId !== null && detailError !== null && <p className="error-text center pad">{detailError}</p>}
          {selectedId !== null && conversation !== null && (
            <>
              <div className="dialog-head">
                <div className="dialog-title">
                  <h2>{t("inbox.conversation", { params: { id: conversation.id.slice(0, 8) } })}</h2>
                  <p className="muted">
                    {t(`state.${conversation.state}`, { fallback: conversation.state })}
                    {conversation.handoff !== null &&
                      ` · ${t(`reason.${conversation.handoff.reason}`, { fallback: conversation.handoff.reason })}`}
                    {conversation.assigned_operator_id !== null &&
                      ` · ${t("inbox.assignedTo", { params: { name: memberName(conversation.assigned_operator_id) } })}`}
                  </p>
                </div>
                <div className="actions">
                  {canAccept && (
                    <button
                      className="btn primary"
                      disabled={acting}
                      onClick={() => {
                        void runAction("accept");
                      }}
                    >
                      {t("inbox.action.accept")}
                    </button>
                  )}
                  {canReturnToAi && (
                    <button
                      className="btn"
                      disabled={acting}
                      onClick={() => {
                        void runAction("return-to-ai");
                      }}
                    >
                      {t("inbox.action.returnToAi")}
                    </button>
                  )}
                  {canClose && (
                    <button
                      className="btn"
                      disabled={acting}
                      onClick={() => {
                        void runAction("close");
                      }}
                    >
                      {t("inbox.action.close")}
                    </button>
                  )}
                  {canReopen && (
                    <button
                      className="btn primary"
                      disabled={acting}
                      onClick={() => {
                        void runAction("reopen");
                      }}
                    >
                      {t("inbox.action.reopen")}
                    </button>
                  )}
                  {canAssign && (
                    <span className="assign-row">
                      <select
                        value={assigneeId}
                        onChange={(e) => setAssigneeId(e.target.value)}
                        aria-label={t("inbox.assignPlaceholder")}
                      >
                        <option value="">{t("inbox.assignPlaceholder")}</option>
                        {members.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            {m.name !== "" ? m.name : m.email}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn"
                        disabled={acting || assigneeId === ""}
                        onClick={() => {
                          void assign();
                        }}
                      >
                        OK
                      </button>
                    </span>
                  )}
                </div>
              </div>

              <div className="transcript" ref={transcriptRef}>
                {messages.length === 0 && !detailLoading && (
                  <p className="muted center">{t("inbox.noMessages")}</p>
                )}
                {messages.map((m) => (
                  <MessageRow key={m.id} message={m} />
                ))}
              </div>

              {actionError !== null && <p className="error-text pad">{actionError}</p>}

              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  value={draft}
                  placeholder={isNote ? t("inbox.notePlaceholder") : t("inbox.replyPlaceholder")}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    // Релей «оператор набирает…» посетителю (docs/13 §5, IR-059):
                    // не для внутренних заметок; debounce 2 с
                    if (!isNote && selectedIdRef.current !== null) {
                      const convId = selectedIdRef.current;
                      if (typingTimerRef.current !== null) clearTimeout(typingTimerRef.current);
                      typingTimerRef.current = window.setTimeout(() => {
                        socketRef.current?.emit("admin:typing", { conversation_id: convId });
                      }, 400);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <label className="note-toggle">
                  <input type="checkbox" checked={isNote} onChange={(e) => setIsNote(e.target.checked)} />
                  {t("inbox.noteToggle")}
                </label>
                <button className="btn primary" type="submit" disabled={sending || draft.trim() === ""}>
                  {isNote ? t("inbox.sendNote") : t("inbox.send")}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Сообщение транскрипта ---

function MessageRow({ message }: { message: AdminMessage }) {
  const { t } = useT();
  const citations = message.citations ?? [];
  const hasFootnote =
    message.role === "assistant" && (citations.length > 0 || message.confidence !== undefined);

  return (
    <div className={`row row-${message.role}`}>
      <span className="msg-meta">
        {t(`role.${message.role}`, { fallback: message.role })} · {formatTime(message.created_at)}
      </span>
      {/* Только текст: React экранирует содержимое, dangerouslySetInnerHTML не используется */}
      <div className={`bubble bubble-${message.role}`}>{message.content}</div>
      {hasFootnote && (
        <span className="msg-foot">
          {message.confidence !== undefined &&
            t("inbox.confidence", { params: { value: Math.round(message.confidence * 100) } })}
          {citations.length > 0 &&
            `${message.confidence !== undefined ? " · " : ""}${t("inbox.citationsCount", { params: { count: citations.length } })}`}
        </span>
      )}
    </div>
  );
}
