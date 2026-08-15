import { ConversationState } from "@uni-chat/shared";

/** Каркас Фазы 0: полная админка — Фаза 5 (docs/30_MVP_IMPLEMENTATION_PLAN.md). */
export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", margin: "3rem" }}>
      <h1>Universal Chat — Admin</h1>
      <p>
        Каркас Фазы 0. Панель (проекты, сайты, ассистент, знания, inbox) строится в Фазе
        4–5 по docs/22_ADMIN_GUIDE.md.
      </p>
      <p style={{ color: "#6b7280" }}>
        Контракты домена уже подключены из @uni-chat/shared: например, состояния диалога —{" "}
        {Object.values(ConversationState).join(", ")}.
      </p>
    </main>
  );
}
