/**
 * Панель оператора (inbox) — первый экранный прототип Фазы 4
 * (docs/30_MVP_IMPLEMENTATION_PLAN.md «Admin-часть inbox», docs/13_OPERATOR_PANEL.md §2–3).
 *
 * Один экран: логин → выбор проекта → вкладки очередей → список диалогов →
 * транскрипт + ответ оператора (в т.ч. внутренняя заметка) + действия по состоянию.
 * Realtime-события /admin подключаются через src/api/socket.ts (пока за флагом-заглушкой).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AdminApi, ApiError } from "./api/client";
import {
  ADMIN_SOCKET_ENABLED,
  connectAdminSocket,
  type AdminSocket,
} from "./api/socket";
import type {
  AdminConversation,
  AdminMessage,
  AuthedUser,
  MemberSummary,
  ProjectSummary,
} from "./api/types";
import {
  describeApiError,
  formatTime,
  reasonLabel,
  ROLE_LABELS,
  stateLabel,
} from "./format";
import "./app.css";

const api = new AdminApi();

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

const TAB_TITLES: Record<TabKey, string> = {
  new: "Новые",
  waiting: "Ожидают оператора",
  active: "Активные",
  mine: "Мои",
  closed: "Закрытые",
};

const TAB_ORDER: readonly TabKey[] = ["new", "waiting", "active", "mine", "closed"];

interface ToastItem {
  id: number;
  text: string;
}

export function App() {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [booting, setBooting] = useState(true);

  // Восстановление сессии по httpOnly-cookie при загрузке (docs/15 §1).
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        // не авторизован — остаёмся на экране логина
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (booting) return <div className="boot">Загрузка…</div>;
  if (user === null) return <LoginScreen onLogin={setUser} />;
  return <InboxScreen user={user} onLogout={() => setUser(null)} />;
}

// --- Экран логина ---

function LoginScreen({ onLogin }: { onLogin: (user: AuthedUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(email.trim(), password);
      onLogin(res.user);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-wrap">
      <form
        className="login-card"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <h1>Universal Chat</h1>
        <p className="login-sub">Панель оператора — вход</p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            required
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            required
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error !== null && <p className="error-text">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}

// --- Inbox ---

function InboxScreen({ user, onLogout }: { user: AuthedUser; onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
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
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  /** 401 в любом запросе → сессия истекла, возвращаемся на логин. */
  const handleMaybeExpired = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) onLogout();
    },
    [onLogout],
  );

  // Проекты (GET /projects) — загружаем один раз.
  useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then((res) => {
        if (cancelled) return;
        setProjects(res.projects);
        const first = res.projects[0];
        if (first !== undefined) setProjectId(first.id);
      })
      .catch((err: unknown) => {
        handleMaybeExpired(err);
        if (!cancelled) setListError(describeApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [handleMaybeExpired]);

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
        if (tab === "mine") {
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
    [projectId, tab, user.id, handleMaybeExpired],
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
        handleMaybeExpired(err);
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
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
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

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // сессия могла истечь — всё равно выходим на экран логина
    }
    onLogout();
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
  // Пока ADMIN_SOCKET_ENABLED=false (TBD: access_token недоступен из JS — см.
  // src/api/socket.ts), события не приходят; списки обновляются кнопкой
  // «Обновить» и после действий оператора. Код ниже включается флагом.
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = projectId;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    if (!ADMIN_SOCKET_ENABLED) return;
    // TBD: передать сюда access_token из тела ответа login, когда сервер начнёт
    // его возвращать (сейчас httpOnly-cookie, JS недоступен).
    const accessToken: string | null = null;
    if (accessToken === null) return;

    const socket: AdminSocket = connectAdminSocket(accessToken);
    const refreshAll = (): void => {
      void loadConversations();
      void loadPendingHandoffs();
    };

    socket.on("connect", () => {
      const pid = projectIdRef.current;
      if (pid !== null) socket.emit("admin:subscribe_project", { project_id: pid });
    });
    socket.on("conversation:created", (payload) => {
      if (payload.conversation.project_id !== projectIdRef.current) return;
      pushToast("Новый диалог");
      refreshAll();
    });
    socket.on("conversation:state_changed", (payload) => {
      if (payload.project_id !== projectIdRef.current) return;
      pushToast(payload.state === "WAITING_OPERATOR" ? "Диалог передан оператору" : "Состояние диалога изменилось");
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
      pushToast("Диалог передан оператору");
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
      socket.disconnect();
    };
  }, [loadConversations, loadPendingHandoffs, loadDetail, pushToast]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Universal Chat · Inbox</span>
        <select
          className="project-select"
          value={projectId ?? ""}
          onChange={(e) => setProjectId(e.target.value === "" ? null : e.target.value)}
          aria-label="Проект"
        >
          {projects.length === 0 && <option value="">Нет доступных проектов</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="btn light"
          disabled={listLoading}
          onClick={() => {
            void loadConversations();
            void loadPendingHandoffs();
          }}
        >
          Обновить
        </button>
        <span className="spacer" />
        {onlineCount !== null && <span className="presence">Операторов онлайн: {onlineCount}</span>}
        <span className="who">{user.name !== "" ? user.name : user.email}</span>
        <button
          className="btn light"
          onClick={() => {
            void logout();
          }}
        >
          Выйти
        </button>
      </header>

      <nav className="tabs" aria-label="Очереди">
        {TAB_ORDER.map((key) => (
          <button
            key={key}
            className={`tab${tab === key ? " active" : ""}`}
            onClick={() => setTab(key)}
          >
            {TAB_TITLES[key]}
            {key === "waiting" && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>

      <div className="workspace">
        <aside className="conv-list">
          {listError !== null && <p className="error-text pad">{listError}</p>}
          {listLoading && conversations.length === 0 && listError === null && (
            <p className="muted pad">Загрузка…</p>
          )}
          {!listLoading && listError === null && sortedConversations.length === 0 && (
            <p className="muted pad">Диалогов нет</p>
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
                <span className={`chip st-${c.state}`}>{stateLabel(c.state)}</span>
                {c.handoff !== null && <span className="chip reason">{reasonLabel(c.handoff.reason)}</span>}
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
              Показать ещё
            </button>
          )}
        </aside>

        <section className="dialog">
          {selectedId === null && <p className="muted center">Выберите диалог слева</p>}
          {selectedId !== null && detailLoading && conversation === null && (
            <p className="muted center">Загрузка диалога…</p>
          )}
          {selectedId !== null && detailError !== null && (
            <p className="error-text center pad">{detailError}</p>
          )}
          {selectedId !== null && conversation !== null && (
            <>
              <div className="dialog-head">
                <div className="dialog-title">
                  <h2>Диалог #{conversation.id.slice(0, 8)}</h2>
                  <p className="muted">
                    {stateLabel(conversation.state)}
                    {conversation.handoff !== null && ` · ${reasonLabel(conversation.handoff.reason)}`}
                    {conversation.assigned_operator_id !== null &&
                      ` · назначен: ${memberName(conversation.assigned_operator_id)}`}
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
                      Принять
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
                      Вернуть AI
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
                      Закрыть
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
                      Открыть снова
                    </button>
                  )}
                  {canAssign && (
                    <span className="assign-row">
                      <select
                        value={assigneeId}
                        onChange={(e) => setAssigneeId(e.target.value)}
                        aria-label="Назначить оператора"
                      >
                        <option value="">Назначить…</option>
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
                  <p className="muted center">Сообщений пока нет</p>
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
                  placeholder={isNote ? "Текст внутренней заметки…" : "Ответ оператора…"}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <label className="note-toggle">
                  <input
                    type="checkbox"
                    checked={isNote}
                    onChange={(e) => setIsNote(e.target.checked)}
                  />
                  внутренняя заметка
                </label>
                <button className="btn primary" type="submit" disabled={sending || draft.trim() === ""}>
                  {isNote ? "Добавить заметку" : "Отправить"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Сообщение транскрипта ---

function MessageRow({ message }: { message: AdminMessage }) {
  const citations = message.citations ?? [];
  const hasFootnote =
    message.role === "assistant" && (citations.length > 0 || message.confidence !== undefined);

  return (
    <div className={`row row-${message.role}`}>
      <span className="msg-meta">
        {ROLE_LABELS[message.role]} · {formatTime(message.created_at)}
      </span>
      {/* Только текст: React экранирует содержимое, dangerouslySetInnerHTML не используется */}
      <div className={`bubble bubble-${message.role}`}>{message.content}</div>
      {hasFootnote && (
        <span className="msg-foot">
          {message.confidence !== undefined && `уверенность AI: ${Math.round(message.confidence * 100)}%`}
          {citations.length > 0 &&
            `${message.confidence !== undefined ? " · " : ""}источников: ${citations.length}`}
        </span>
      )}
    </div>
  );
}
