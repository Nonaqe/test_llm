/**
 * Сид демо-окружения: владелец → проект → сайт (публичный ключ виджета) →
 * загрузка docs/*.md в базу знаний → настройки AI-провайдера (opencode zen).
 * Запуск: node demo/seed.mjs (API должен быть на :3000, SETUP_TOKEN задан).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API = process.env.API_URL ?? "http://127.0.0.1:3000";
const SETUP_TOKEN = "demo-setup-token-42";
const OWNER = { email: "owner@demo.local", password: "demo-owner-2026", name: "Demo Owner" };
// Ключ шлюза передаётся через env (не хранится в репозитории!)
const ZEN_KEY = process.env.ZEN_KEY ?? "";
const CHAT_MODEL = process.env.CHAT_MODEL ?? "claude-haiku-4-5";

let cookies = [];
function jar(res) {
  const sc = res.headers.getSetCookie?.() ?? [];
  for (const c of sc) cookies.push(c.split(";")[0]);
}
const cookieHeader = () => cookies.join("; ");

async function call(method, path, body, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.auth === false ? {} : { Cookie: cookieHeader() }),
      ...(opts.idem ? { "Idempotency-Key": opts.idem } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar(res);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json.data ?? json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Владелец (setup идемпотентностью не обладает: если уже создан — логинимся)
let authed = false;
const setup = await fetch(`${API}/api/v1/setup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: SETUP_TOKEN, ...OWNER }),
});
jar(setup);
if (setup.ok) {
  console.log("✓ владелец создан");
  authed = true;
} else {
  const body = await setup.json().catch(() => ({}));
  const code = body?.error?.code;
  if (code === "SETUP_ALREADY_DONE" || setup.status === 409 || code === "conflict") {
    console.log("• setup уже выполнен — логинимся");
  } else {
    throw new Error(`setup failed: ${setup.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
}
if (!authed) {
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
  });
  jar(login);
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  console.log("✓ вход выполнен");
}

// 2. Проект — идемпотентно: ищем существующий по имени (аудит IR-059:
// повторный прогон создавал каждый раз новый проект и дублировал документы)
const PROJECT_NAME = "UniChat Platform";
let project;
const existing = await call("GET", "/api/v1/projects");
project = existing.projects.find((p) => p.name === PROJECT_NAME);
if (project) {
  console.log(`• проект уже существует ${project.id}`);
} else {
  ({ project } = await call("POST", "/api/v1/projects", { name: PROJECT_NAME }));
  console.log(`✓ проект ${project.id}`);
}

// 3. Сайт с публичным ключом виджета — тоже идемпотентно
let site;
const { sites } = await call("GET", `/api/v1/projects/${project.id}/sites`);
site = sites.find((s) => s.domain === "localhost");
if (site) {
  console.log(`• сайт уже существует ${site.id}, widget_public_key=${site.widget_public_key}`);
} else {
  ({ site } = await call("POST", `/api/v1/projects/${project.id}/sites`, {
    name: "Local Demo Site",
    domain: "localhost",
    allowed_origins: ["http://localhost:8088", "http://127.0.0.1:8088"],
  }));
  console.log(`✓ сайт ${site.id}, widget_public_key=${site.widget_public_key}`);
}
console.log("  → demo/site/index.html использует этот ключ");

// 4. База знаний — все docs/*.md проекта. Сервер НЕ поддерживает
// Idempotency-Key на knowledge/texts (аудит IR-059), поэтому идемпотентность
// клиентская: пропускаем документы с уже существующим title.
const docsDir = fileURLToPath(new URL("../docs/", import.meta.url));
const files = (await readdir(docsDir)).filter((f) => f.endsWith(".md"));
const { documents: existingDocs } = await call("GET", `/api/v1/projects/${project.id}/knowledge/documents`);
const knownTitles = new Set(existingDocs.map((d) => d.title));
let ready = 0;
for (const f of files) {
  if (knownTitles.has(f)) continue;
  const text = await readFile(docsDir + f, "utf8");
  if (text.trim().length < 200) continue; // пропускаем служебные заглушки
  await call("POST", `/api/v1/projects/${project.id}/knowledge/texts`, {
    title: f,
    text,
  });
  ready++;
}
console.log(`✓ документов отправлено: ${ready} (уже в базе: ${existingDocs.length})`);

// Ждём готовности индексации (эмбеддинги fake — быстро)
const deadline = Date.now() + 120_000;
for (;;) {
  const { documents } = await call("GET", `/api/v1/projects/${project.id}/knowledge/documents`);
  const pending = documents.filter((d) => d.status !== "ready" && d.status !== "failed");
  const failed = documents.filter((d) => d.status === "failed");
  if (pending.length === 0) {
    console.log(`✓ индексация завершена: ${documents.length} док., ошибок: ${failed.length}`);
    if (failed.length) console.log("  failed:", failed.map((d) => `${d.title}(${d.error ?? "?"})`).join(", ").slice(0, 400));
    break;
  }
  if (Date.now() > deadline) throw new Error(`индексация не завершилась: ${pending.map((d) => d.title).join(", ")}`);
  await sleep(1500);
}

// 5. Порог гейта 0.3 (fake-эмбеддинги — как в CI phase3/5)
await call("PATCH", `/api/v1/projects/${project.id}/assistant`, {
  retrieval_settings: { score_threshold: 0.3 },
});
console.log("✓ assistant: score_threshold=0.3");

// 6. AI-провайдер: opencode zen (реальная LLM, эмбеддинги — fake-гибрид).
// Без ZEN_KEY остаёмся на дефолтном kind=fake — демо отвечает заготовками,
// а не падает с 502 на каждом сообщении (аудит IR-059)
if (ZEN_KEY) {
  await call("PUT", "/api/v1/settings/ai_provider.kind", { key: "ai_provider.kind", value: "openai_compatible" });
  await call("PUT", "/api/v1/settings/ai_provider.base_url", { key: "ai_provider.base_url", value: "https://opencode.ai/zen/v1" });
  await call("PUT", "/api/v1/settings/ai_provider.chat_model", { key: "ai_provider.chat_model", value: CHAT_MODEL });
  await call("PUT", "/api/v1/settings/ai_provider.embedding_model", { key: "ai_provider.embedding_model", value: "" });
  await call("PUT", "/api/v1/settings/ai_provider.api_key", { key: "ai_provider.api_key", value: ZEN_KEY, is_secret: true });
  console.log(`✓ провайдер opencode zen (${CHAT_MODEL}), api_key зашифрован AES-256-GCM`);
} else {
  console.log("⚠ ZEN_KEY не задан — работаем на kind=fake (заготовленные ответы)");
}

const check = await call("POST", "/api/v1/settings/ai-provider/check");
console.log(`✓ ai-provider/check: ${JSON.stringify(check)}`);

console.log("\nDEMO READY:");
console.log(`  project_id        = ${project.id}`);
console.log(`  widget_public_key = ${site.widget_public_key}`);
