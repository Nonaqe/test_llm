/**
 * Публичный SDK виджета (docs/08_WIDGET.md §3):
 * ChatWidget.init/open/close/toggle/identify/on/setLocale/destroy.
 * Автоинициализация — по data-chat-key на теге скрипта (docs/08 §3):
 * ESM-скрипты не имеют document.currentScript, ищем тег с ключом
 * (в MVP один виджет на страницу — docs/10).
 */
import type { WidgetMessageDto } from "@uni-chat/shared";
import { UniChatWidgetElement, onMessage } from "./element";

const TAG = "uni-chat-widget";

export interface ChatWidgetInitOptions {
  key: string;
  /** Переопределение сервера (по умолчанию — origin скрипта; для dev-стенда) */
  server?: string;
}

export const ChatWidget = {
  version: "0.2.0-phase2",

  init(options: ChatWidgetInitOptions): void {
    if (!options?.key) throw new Error("ChatWidget.init: требуется { key }");
    mount(options.key, options.server);
  },

  open(): void {
    find()?.open();
  },

  close(): void {
    find()?.close();
  },

  toggle(): void {
    find()?.toggle();
  },

  identify(attributes: { name?: string; email?: string }): void {
    find()?.identify(attributes);
  },

  on(event: "message", handler: (message: WidgetMessageDto) => void): () => void {
    if (event !== "message") throw new Error(`Неизвестное событие: ${event}`);
    return onMessage(handler);
  },

  setLocale(locale: string): void {
    find()?.setLocale(locale);
  },

  destroy(): void {
    find()?.destroy();
  },
};

function find(): UniChatWidgetElement | null {
  return document.querySelector<UniChatWidgetElement>(TAG);
}

function mount(key: string, server?: string): UniChatWidgetElement {
  const existing = find();
  if (existing) {
    existing.setAttribute("key", key);
    if (server) existing.setAttribute("server", server);
    return existing;
  }
  const el = document.createElement(TAG) as UniChatWidgetElement;
  el.setAttribute("key", key);
  if (server) el.setAttribute("server", server);
  document.body.appendChild(el);
  return el;
}

declare global {
  interface Window {
    ChatWidget?: typeof ChatWidget;
  }
}

if (typeof window !== "undefined" && !customElements.get(TAG)) {
  customElements.define(TAG, UniChatWidgetElement);
}
if (typeof window !== "undefined") {
  window.ChatWidget = ChatWidget;
  const script = document.querySelector<HTMLScriptElement>("script[data-chat-key]");
  if (script?.dataset.chatKey && !find()) {
    mount(script.dataset.chatKey, script.dataset.chatServer);
  }
}

export { ChatWidget as default };
