/**
 * UniChat widget — каркас Фазы 0 (docs/08_WIDGET.md).
 * Web Component + Shadow DOM (ADR-004): изоляция CSS/JS от сайта,
 * единственная «дырка» — CSS-переменные --uni-chat-* (уровень 2 кастомизации).
 * Полный чат (API, Socket.IO, стриминг) — Фаза 2.
 */
const TAG = "uni-chat-widget";
const WIDGET_VERSION = "0.1.0-phase0";

const STYLES = `
  :host {
    /* Управляемая темизация сайтом (docs/08 §4) */
    --_accent: var(--uni-chat-accent, #4f46e5);
    --_position-bottom: var(--uni-chat-position-bottom, 20px);
    --_z-index: var(--uni-chat-z-index, 2147483000);
    position: fixed;
    right: 20px;
    bottom: var(--_position-bottom);
    z-index: var(--_z-index);
    font-family: var(--uni-chat-font-family, system-ui, -apple-system, sans-serif);
    font-size: var(--uni-chat-font-size, 15px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .launcher {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background: var(--_accent);
    color: #fff;
    font-size: 24px;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  .panel {
    position: absolute;
    right: 0;
    bottom: 68px;
    width: min(360px, calc(100vw - 40px));
    height: min(520px, calc(100vh - 120px));
    background: var(--uni-chat-bg, #fff);
    color: var(--uni-chat-fg, #111827);
    border-radius: var(--uni-chat-radius, 12px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
    display: none;
    flex-direction: column;
    overflow: hidden;
  }
  .panel.open { display: flex; }
  .panel header {
    background: var(--_accent);
    color: #fff;
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .panel header strong { font-size: 15px; }
  .panel header button {
    background: transparent;
    border: none;
    color: #fff;
    font-size: 18px;
    cursor: pointer;
  }
  .panel .body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: #6b7280;
    padding: 16px;
  }
`;

class UniChatWidgetElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["key"];
  }

  private shadow: ShadowRoot | null = null;
  private panel: HTMLElement | null = null;

  connectedCallback(): void {
    if (this.shadow) return;
    this.shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;

    const root = document.createElement("div");

    const panel = document.createElement("div");
    panel.className = "panel";
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "Universal Chat";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Закрыть чат");
    closeBtn.addEventListener("click", () => this.close());
    header.append(title, closeBtn);
    const body = document.createElement("div");
    body.className = "body";
    body.textContent =
      "Каркас Фазы 0. Чат (AI, операторы, realtime) подключается в Фазе 2 — docs/30_MVP_IMPLEMENTATION_PLAN.md";
    panel.append(header, body);

    const launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", "Открыть чат");
    launcher.textContent = "💬";
    launcher.addEventListener("click", () => this.toggle());

    root.append(panel, launcher);
    this.shadow.append(style, root);
    this.panel = panel;
  }

  get key(): string | null {
    return this.getAttribute("key");
  }

  open(): void {
    this.panel?.classList.add("open");
  }

  close(): void {
    this.panel?.classList.remove("open");
  }

  toggle(): void {
    this.panel?.classList.toggle("open");
  }
}

function mount(key: string): UniChatWidgetElement {
  const existing = document.querySelector<UniChatWidgetElement>(TAG);
  if (existing) {
    existing.setAttribute("key", key);
    return existing;
  }
  const el = document.createElement(TAG) as UniChatWidgetElement;
  el.setAttribute("key", key);
  document.body.appendChild(el);
  return el;
}

/** Публичный SDK (docs/08_WIDGET.md §3). Полный набор — Фаза 2. */
export const ChatWidget = {
  version: WIDGET_VERSION,
  init(options: { key: string }): void {
    if (!options?.key) throw new Error("ChatWidget.init: требуется { key }");
    mount(options.key);
  },
  open(): void {
    document.querySelector<UniChatWidgetElement>(TAG)?.open();
  },
  close(): void {
    document.querySelector<UniChatWidgetElement>(TAG)?.close();
  },
  toggle(): void {
    document.querySelector<UniChatWidgetElement>(TAG)?.toggle();
  },
};

declare global {
  interface Window {
    ChatWidget?: typeof ChatWidget;
  }
}

if (!customElements.get(TAG)) {
  customElements.define(TAG, UniChatWidgetElement);
}
window.ChatWidget = ChatWidget;

// Автоинициализация по data-chat-key на скрипте (docs/08 §3).
// ESM-скрипты не имеют document.currentScript — ищем тег с ключом
// (в MVP один виджет на страницу — docs/10_UNIVERSAL_INTEGRATION.md).
const script = document.querySelector<HTMLScriptElement>("script[data-chat-key]");
if (script?.dataset.chatKey) {
  mount(script.dataset.chatKey);
}
