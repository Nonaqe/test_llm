/**
 * E2E-проверка демо: init → диалог → вопрос о проекте → ответ с цитатами.
 * Тот же путь, что и у виджета в браузере. Запуск: node demo/e2e-check.mjs
 */
const API = process.env.API_URL ?? "http://127.0.0.1:3000";
// Ключ меняется при пересиде БД — актуальный печатает seed.mjs (DEMO READY);
// WIDGET_KEY env перекрывает дефолт
const KEY = process.env.WIDGET_KEY ?? "l09TXvpj_zfT_9W3mF-IzzbiUD85XvNd";

let visitor = "";
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:8088",
      ...(visitor ? { Authorization: `Bearer ${visitor}` } : {}),
      ...(body ? { "Idempotency-Key": `e2e-${Math.random().toString(36).slice(2)}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 429) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { status: res.status, json };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. init посетителя
const init = await call("POST", "/widget/v1/init", {
  key: KEY,
  anon_id: `demo-${Math.random().toString(36).slice(2, 12)}`,
});
if (init.status === 429) throw new Error("init rate-limited");
visitor = init.json.data.visitor_token;
console.log("✓ init:", Object.keys(init.json.data).join(", "));

// 2. диалог
const conv = await call("POST", "/widget/v1/conversations");
const conversationId = conv.json.data.conversation.id;
console.log("✓ conversation:", conversationId);

// 3. вопрос по проекту (RAG из docs/*.md)
const question = process.argv[2] ?? "Какие фазы реализации есть в проекте и что уже сделано?";
const sent = await call("POST", `/widget/v1/conversations/${conversationId}/messages`, { text: question });
if (sent.status !== 201) throw new Error(`send failed: ${sent.status}`);
// ждём ответ СТРОГО после нашего visitor-сообщения: after_seq=1 находил
// старые ответы прошлых прогонов (аудит IR-059)
const sentSeq = sent.json.data.message.seq;
console.log("✓ вопрос отправлен:", question, `(seq=${sentSeq})`);

// 4. ждём ответ ассистента
const deadline = Date.now() + 90_000;
let answer = null;
for (;;) {
  const msgs = await call(
    "GET",
    `/widget/v1/conversations/${conversationId}/messages?after_seq=${sentSeq}`,
  );
  const found = (msgs.json.data?.messages ?? []).find(
    (m) => m.role === "assistant" && (m.citations?.length || m.content),
  );
  if (found) { answer = found; break; }
  if (Date.now() > deadline) throw new Error("ответ не получен за 90с");
  await sleep(2000);
}

console.log("\n════════ ОТВЕТ ════════");
console.log(answer.content);
console.log("────────────────────────");
console.log("citations:", JSON.stringify(answer.citations ?? []));
console.log("confidence:", answer.confidence ?? "(нет)");
// Явный exit: без него node24/undici на Windows падает в libuv-ассерте при дренировании keep-alive
process.exit(0);
