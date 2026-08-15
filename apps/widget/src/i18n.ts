/** Локализация виджета (docs/08 §5). Язык берётся из widget config сайта. */
export type WidgetLocale = "ru" | "en";

export interface WidgetStrings {
  title: string;
  inputPlaceholder: string;
  send: string;
  connecting: string;
  offline: string;
  waitingOperator: string;
  newConversation: string;
  rateLimited: string;
  genericError: string;
}

const ru: WidgetStrings = {
  title: "Чат",
  inputPlaceholder: "Напишите сообщение…",
  send: "Отправить",
  connecting: "Подключение…",
  offline: "Офлайн — сообщения доставим при подключении",
  waitingOperator: "Оператор подключается…",
  newConversation: "Новый диалог",
  rateLimited: "Слишком много сообщений — подождите немного",
  genericError: "Ошибка отправки. Попробуйте ещё раз",
};

const en: WidgetStrings = {
  title: "Chat",
  inputPlaceholder: "Type a message…",
  send: "Send",
  connecting: "Connecting…",
  offline: "Offline — messages will be delivered on reconnect",
  waitingOperator: "Connecting you to an operator…",
  newConversation: "New conversation",
  rateLimited: "Too many messages — please wait a moment",
  genericError: "Failed to send. Please try again",
};

export function stringsFor(locale: string): WidgetStrings {
  return locale.toLowerCase().startsWith("en") ? en : ru;
}
