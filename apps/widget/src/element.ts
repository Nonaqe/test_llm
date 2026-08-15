/**
 * UniChat widget — Web Component + Shadow DOM (ADR-004, docs/08_WIDGET.md).
 * Фаза 2: полноценный чат против /widget/v1 + Socket.IO; рендер текста —
 * только через textContent (XSS-безопасность по построению; markdown+DOMPurify
 * приходят в Фазе 3 вместе со стримингом).
 */
import type { WidgetConfig, WidgetConversationDto, WidgetMessageDto } from "@uni-chat/shared";
import { WidgetApi, type WidgetApiError } from "./api";
import { WidgetSocket } from "./sock";
import { stringsFor, type WidgetStrings } from "./i18n";
import { WIDGET_STYLES } from "./styles";

const WIDGET_VERSION = "0.2.0-phase2";

type MessageHandler = (message: WidgetMessageDto) => void;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим — идентичность переживёт только сессию */
  }
}

export class UniChatWidgetElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["key", "server"];
  }

  private shadow: ShadowRoot | null = null;
  private api: WidgetApi | null = null;
  private socket: WidgetSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private token = "";
  private config: WidgetConfig | null = null;
  private strings: WidgetStrings = stringsFor("ru");
  private conversation: WidgetConversationDto | null = null;
  private readonly messages = new Map<string, WidgetMessageDto>();
  private lastSeq = 0;
  private unread = 0;
  private booted = false;
  /** Live-пузырь стриминга AI (ai_token); заменяется финальным message (docs/05 §6) */
  private liveBubble: HTMLElement | null = null;

  // DOM-ссылки
  private refs: {
    panel: HTMLElement;
    dot: HTMLElement;
    title: HTMLElement;
    list: HTMLElement;
    typing: HTMLElement;
    statusline: HTMLElement;
    input: HTMLTextAreaElement;
    send: HTMLButtonElement;
    badge: HTMLElement;
  } | null = null;

  connectedCallback(): void {
    if (this.shadow) return;
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.innerHTML = "";
    this.buildDom();
    if (this.getAttribute("key")) void this.boot();
  }

  disconnectedCallback(): void {
    this.destroyInternals();
  }

  get key(): string | null {
    return this.getAttribute("key");
  }

  private resolveBaseUrl(): string {
    const attr = this.getAttribute("server");
    if (attr) return attr.replace(/\/+$/, "");
    const script = document.querySelector<HTMLScriptElement>("script[data-chat-key]");
    const fromAttr = script?.dataset.chatServer;
    if (fromAttr) return fromAttr.replace(/\/+$/, "");
    if (script?.src) return new URL(script.src).origin;
    return window.location.origin;
  }

  private buildDom(): void {
    const s = this.shadow!;
    const style = document.createElement("style");
    style.textContent = WIDGET_STYLES;

    const panel = document.createElement("div");
    panel.className = "panel";

    const header = document.createElement("header");
    const dot = document.createElement("span");
    dot.className = "dot";
    const title = document.createElement("span");
    title.className = "title";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Закрыть");
    closeBtn.addEventListener("click", () => this.close());
    header.append(dot, title, closeBtn);

    const list = document.createElement("div");
    list.className = "messages";

    const typing = document.createElement("div");
    typing.className = "typing";
    for (let i = 0; i < 3; i++) {
      const d = document.createElement("span");
      d.className = "dot-anim";
      typing.appendChild(d);
    }

    const statusline = document.createElement("div");
    statusline.className = "statusline";

    const form = document.createElement("form");
    form.className = "input-row";
    const input = document.createElement("textarea");
    input.rows = 1;
    input.placeholder = "";
    input.setAttribute("aria-label", "Сообщение");
    const send = document.createElement("button");
    send.type = "submit";
    form.append(input, send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.handleSend();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });
    let typingStopTimer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener("input", () => {
      if (!this.conversation) return;
      this.socket?.typingStart(this.conversation.id);
      if (typingStopTimer) clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(() => this.socket?.typingStop(this.conversation!.id), 2500);
    });

    panel.append(header, list, typing, statusline, form);

    const launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", "Открыть чат");
    launcher.textContent = "💬";
    const badge = document.createElement("span");
    badge.className = "badge";
    launcher.appendChild(badge);
    launcher.addEventListener("click", () => this.toggle());

    s.append(style, launcher, panel);

    this.refs = { panel, dot, title, list, typing, statusline, input, send, badge };
    this.applyStrings();
    this.applyConfigAttrs();
  }

  private async boot(): Promise<void> {
    const key = this.key;
    if (!key || this.booted) return;
    this.booted = true;

    const baseUrl = this.resolveBaseUrl();
    this.api = new WidgetApi(baseUrl);

    const anonKey = `unichat:anon:${key}`;
    let anonId = lsGet(anonKey);
    if (!anonId) {
      anonId = randomId();
      lsSet(anonKey, anonId);
    }
    const attributes = JSON.parse(lsGet(`unichat:identify:${key}`) ?? "{}") as Record<
      string,
      unknown
    >;

    this.setStatus("connecting");
    try {
      const res = await this.api.init({
        key,
        anon_id: anonId,
        attributes,
      });
      this.token = res.visitor_token;
      this.config = res.widget;
      this.applyStrings();
      this.applyConfigAttrs();
      if (this.config.greeting && !res.conversation) {
        this.appendLocalGreeting(this.config.greeting);
      }
      if (res.conversation) {
        this.conversation = res.conversation;
        await this.catchUp();
      }
      this.connectSocket();
      this.setStatus(null);
    } catch (err) {
      this.setStatus("error", err);
    }
  }

  private connectSocket(): void {
    if (!this.api || !this.token) return;
    this.socket = new WidgetSocket(this.resolveBaseUrl(), this.token, {
      onMessage: (m) => this.handleIncoming(m),
      onState: (p) => this.handleState(p.state),
      onAiToken: (p) => this.handleAiToken(p.token),
      onConnect: () => {
        this.setDot(true);
        this.stopPolling();
        if (this.conversation) {
          void this.socket?.join(this.conversation.id).then(() => this.catchUp());
        }
      },
      onDisconnect: () => {
        this.setDot(false);
        this.startPolling();
      },
    });
  }

  private async ensureConversation(): Promise<WidgetConversationDto> {
    if (this.conversation) return this.conversation;
    const conversation = await this.api!.createConversation(this.token);
    this.conversation = conversation;
    await this.socket?.join(conversation.id);
    return conversation;
  }

  private async handleSend(): Promise<void> {
    const refs = this.refs;
    if (!refs || !this.api || !this.token) return;
    const text = refs.input.value.trim();
    if (!text) return;
    refs.input.value = "";
    refs.send.disabled = true;
    try {
      const conversation = await this.ensureConversation();
      const message = await this.api.sendMessage(
        this.token,
        conversation.id,
        text,
        randomId(),
      );
      this.handleIncoming(message);
      refs.typing.classList.add("visible");
    } catch (err) {
      const e = err as WidgetApiError;
      refs.input.value = text; // не теряем введённое
      this.setStatus("error", e.code === "RATE_LIMITED" ? new Error(this.strings.rateLimited) : err);
    } finally {
      refs.send.disabled = false;
      refs.input.focus();
    }
  }

  private handleIncoming(message: WidgetMessageDto): void {
    if (this.messages.has(message.id)) return;
    this.messages.set(message.id, message);
    if (message.seq > this.lastSeq) this.lastSeq = message.seq;
    if (message.role !== "visitor") {
      this.refs?.typing.classList.remove("visible");
      if (!this.refs?.panel.classList.contains("open")) {
        this.unread += 1;
        this.updateBadge();
      }
    }
    this.renderMessages(); // финальное сообщение заменяет live-пузырь
    emitGlobal("message", message);
  }

  /** Стрим AI: инкрементальный текст; рендер textContent-only (XSS по построению). */
  private handleAiToken(token: string): void {
    const refs = this.refs;
    if (!refs) return;
    refs.typing.classList.remove("visible");
    if (!this.liveBubble || !this.liveBubble.isConnected) {
      const row = document.createElement("div");
      row.className = "row assistant";
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      row.appendChild(bubble);
      refs.list.appendChild(row);
      this.liveBubble = bubble;
    }
    this.liveBubble.textContent += token;
    refs.list.scrollTop = refs.list.scrollHeight;
  }

  private handleState(state: string): void {
    if (state === "WAITING_OPERATOR" || state === "OPERATOR_ACTIVE") {
      this.setStatus("custom", new Error(this.strings.waitingOperator));
    }
  }

  private async catchUp(): Promise<void> {
    if (!this.api || !this.token || !this.conversation) return;
    try {
      const messages = await this.api.listMessages(
        this.token,
        this.conversation.id,
        this.lastSeq,
      );
      for (const m of messages) this.handleIncoming(m);
    } catch {
      /* кэтч-ап повторится по polling-таймеру или reconnect */
    }
  }

  private startPolling(): void {
    if (this.pollTimer || !this.conversation) return;
    this.setStatus("offline");
    this.pollTimer = setInterval(() => void this.catchUp(), 3000);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.refs && this.refs.statusline.classList.contains("visible")) {
      this.setStatus(null);
    }
  }

  private appendLocalGreeting(text: string): void {
    const el = document.createElement("div");
    el.className = "row system";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    el.appendChild(bubble);
    this.refs?.list.appendChild(el);
  }

  private renderMessages(): void {
    const refs = this.refs;
    if (!refs) return;
    refs.list.textContent = "";
    this.liveBubble = null; // список перестроен — live-пузырь более не валиден
    const sorted = [...this.messages.values()].sort((a, b) => a.seq - b.seq);
    for (const m of sorted) {
      const row = document.createElement("div");
      row.className = `row ${m.role}`;
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = m.content; // XSS-защита по построению (Ф2)
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = new Date(m.created_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      row.append(bubble, time);
      refs.list.appendChild(row);
    }
    refs.list.scrollTop = refs.list.scrollHeight;
  }

  private updateBadge(): void {
    const badge = this.refs?.badge;
    if (!badge) return;
    badge.textContent = String(this.unread > 9 ? "9+" : this.unread);
    badge.classList.toggle("visible", this.unread > 0);
  }

  private setDot(on: boolean): void {
    this.refs?.dot.classList.toggle("on", on);
  }

  private setStatus(
    kind: "connecting" | "offline" | "error" | "custom" | null,
    err?: unknown,
  ): void {
    const refs = this.refs;
    if (!refs) return;
    if (kind === null) {
      refs.statusline.classList.remove("visible");
      refs.statusline.textContent = "";
      return;
    }
    const text =
      kind === "connecting"
        ? this.strings.connecting
        : kind === "offline"
          ? this.strings.offline
          : err instanceof Error
            ? err.message
            : this.strings.genericError;
    refs.statusline.textContent = text;
    refs.statusline.classList.add("visible");
  }

  private applyStrings(): void {
    const refs = this.refs;
    if (!refs) return;
    this.strings = stringsFor(this.config?.locale ?? "ru");
    refs.title.textContent = this.strings.title;
    refs.input.placeholder = this.strings.inputPlaceholder;
    refs.send.textContent = this.strings.send;
  }

  private applyConfigAttrs(): void {
    if (!this.config) return;
    if (this.config.theme.position === "left") this.setAttribute("position", "left");
  }

  setLocale(locale: string): void {
    if (this.config) this.config.locale = locale;
    this.applyStrings();
  }

  identify(attributes: { name?: string; email?: string }): void {
    const key = this.key;
    if (!key) return;
    lsSet(`unichat:identify:${key}`, JSON.stringify(attributes));
  }

  open(): void {
    const refs = this.refs;
    if (!refs) return;
    refs.panel.classList.add("open");
    this.unread = 0;
    this.updateBadge();
    refs.input.focus();
    void this.catchUp();
  }

  close(): void {
    this.refs?.panel.classList.remove("open");
  }

  toggle(): void {
    if (this.refs?.panel.classList.contains("open")) this.close();
    else this.open();
  }

  private destroyInternals(): void {
    this.stopPolling();
    this.socket?.close();
    this.socket = null;
    this.messages.clear();
  }

  destroy(): void {
    this.destroyInternals();
    this.remove();
  }
}

// --- глобальный эмиттер для ChatWidget.on('message') ---
const messageHandlers = new Set<MessageHandler>();

function emitGlobal(event: "message", payload: WidgetMessageDto): void {
  if (event !== "message") return;
  for (const h of messageHandlers) h(payload);
}

export function onMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

export const WIDGET_VERSION_STRING = WIDGET_VERSION;
