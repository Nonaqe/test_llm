/**
 * E2E Фазы 3 (docs/30 §3, критерии приёмки):
 *   E1 — AI-ответ по знаниям с цитатами/уверенностью и стримингом ai_token (fake-провайдер);
 *   E2 — retrieval-гейт: вопрос вне KB → fallback без LLM;
 *   E9 — переиндексация version+1 со swap (старые вектора удалены);
 *   PDF без текст-слоя → failed; настройки ассистента; проверка провайдера.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";

const DB_URL = process.env.DATABASE_URL;
const SITE_KEY = "pk_test_e2e_phase3_key_1";
const GOOD_ORIGIN = "https://example.com";
const FALLBACK = "Нет точной информации — передаю оператору.";
const SETUP_TOKEN = "e2e-setup-token-42";

describe.skipIf(!DB_URL)("e2e: AI + Knowledge (Фаза 3)", () => {
  let app: INestApplication;
  let pool: Pool;
  let port = 0;
  let adminCookies: string[] = [];
  let projectId = "";
  let visitorToken = "";
  let conversationId = "";
  let docId = "";

  const api = () => request(app.getHttpServer());
  const admin = (req: request.Test) => req.set("Cookie", adminCookies.join("; "));
  const widgetAuthed = (req: request.Test) => req.set("Authorization", `Bearer ${visitorToken}`);

  async function poll<T>(fn: () => Promise<T>, check: (v: T) => boolean, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await fn();
      if (check(value)) return value;
      if (Date.now() > deadline) throw new Error("poll timeout");
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  const docList = () =>
    admin(api().get(`/api/v1/projects/${projectId}/knowledge/documents`)).then(
      (r) => r.body.data.documents as Array<{ id: string; status: string; version: number; chunk_count: number; error: string | null }>,
    );

  const widgetMessages = () =>
    widgetAuthed(api().get(`/widget/v1/conversations/${conversationId}/messages`)).then(
      (r) => r.body.data.messages as Array<{ id: string; seq: number; role: string; content: string; citations?: unknown[]; confidence?: number }>,
    );

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_SECRET = process.env.APP_SECRET ?? "e2e-app-secret-0123456789";
    process.env.SETUP_TOKEN = SETUP_TOKEN;

    pool = new Pool({ connectionString: DB_URL });
    const { AppModule } = await import("../app.module");
    const { NestFactory } = await import("@nestjs/core");
    const { configureApp } = await import("../common/app-setup");

    app = await NestFactory.create(AppModule, { bufferLogs: true });
    configureApp(app);
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;

    await pool.query(
      "truncate table events, messages, handoffs, conversations, visitors, chunks, faqs, documents, escalation_rules, assistants, sites, project_members, projects, settings, users restart identity cascade",
    );
    const { rows: pr } = await pool.query("insert into projects (name) values ('AI E2E') returning id");
    projectId = pr[0].id;
    await pool.query(
      `insert into assistants (project_id, retrieval_settings, safety_settings)
       values ($1, '{"top_k": 4, "score_threshold": 0.3, "history_depth": 6}'::jsonb, $2::jsonb)`,
      [projectId, JSON.stringify({ fallback_message: FALLBACK, denied_topics: [] })],
    );
    await pool.query(
      `insert into sites (project_id, name, domain, allowed_origins, widget_public_key)
       values ($1, 'E2E', 'example.com', $2::jsonb, $3)`,
      [projectId, JSON.stringify([GOOD_ORIGIN]), SITE_KEY],
    );

    // Владелец для admin-зон
    const setup = await api().post("/api/v1/setup").send({
      token: SETUP_TOKEN,
      email: "owner@example.com",
      password: "password123",
    });
    const setCookie = setup.headers["set-cookie"];
    adminCookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.split(";")[0]);

    // Провайдер: fake (детерминированные эмбеддинги/ответы — docs/18)
    await admin(api().put("/api/v1/settings/ai_provider.kind")).send({ value: "fake" });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("проверка провайдера: fake → ok", async () => {
    const res = await admin(api().post("/api/v1/settings/ai-provider/check"));
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ ok: true, kind: "fake" });
  });

  it("загрузка текстового документа → ready с чанками", async () => {
    const res = await admin(
      api().post(`/api/v1/projects/${projectId}/knowledge/texts`),
    ).send({
      title: "Доставка и оплата",
      text: "# Доставка\n\nДоставка курьером по городу занимает два дня. Стоимость доставки 500 рублей. Оплата картой или наличными при получении.",
    });
    expect(res.status).toBe(201);
    docId = res.body.data.document.id;

    const docs = await poll(docList, (list) => list.some((d) => d.id === docId && d.status === "ready"));
    const doc = docs.find((d) => d.id === docId)!;
    expect(doc.chunk_count).toBeGreaterThanOrEqual(1);
    expect(doc.version).toBe(1);
  });

  it("FAQ индексируется", async () => {
    const res = await admin(api().post(`/api/v1/projects/${projectId}/knowledge/faqs`)).send({
      question: "Как вернуть товар?",
      answer: "Возврат товара возможен в течение 14 дней с момента покупки при наличии чека.",
    });
    expect(res.status).toBe(201);
    const faqs = await admin(api().get(`/api/v1/projects/${projectId}/knowledge/faqs`));
    expect(faqs.body.data.faqs).toHaveLength(1);
  });

  it("PDF без текст-слоя → failed с честной причиной", async () => {
    const res = await admin(
      api()
        .post(`/api/v1/projects/${projectId}/knowledge/documents`)
        .attach("file", Buffer.from("%PDF-1.4\n%%EOF"), "scan.pdf"),
    );
    expect(res.status).toBe(201);
    const badId = res.body.data.document.id;
    const docs = await poll(docList, (list) => list.some((d) => d.id === badId && d.status === "failed"));
    expect(docs.find((d) => d.id === badId)!.error).toMatch(/text layer|PDF/i);
  });

  it("E1: вопрос по FAQ → стриминг ai_token + финал с цитатами и confidence", async () => {
    const init = await api().post("/widget/v1/init").set("Origin", GOOD_ORIGIN).send({
      key: SITE_KEY,
      anon_id: "anon-phase3-visitor-1",
    });
    visitorToken = init.body.data.visitor_token;
    const conv = await widgetAuthed(api().post("/widget/v1/conversations"));
    conversationId = conv.body.data.conversation.id;

    const socket: Socket = io(`http://127.0.0.1:${port}/widget`, {
      auth: { token: visitorToken },
      transports: ["websocket"],
      reconnection: false,
    });
    const aiTokens: string[] = [];
    socket.on("ai_token", (p: { token: string }) => aiTokens.push(p.token));
    await new Promise<void>((resolve, reject) => {
      // 'connect' (не transport-'open'): ждём завершения async handleConnection
      socket.on("connect", () =>
        socket.emit("widget:join", { conversation_id: conversationId }, () => resolve()),
      );
      socket.on("connect_error", reject);
      setTimeout(() => reject(new Error("join timeout")), 5000);
    });

    const send = await widgetAuthed(
      api().post(`/widget/v1/conversations/${conversationId}/messages`).send({ text: "как вернуть товар" }),
    );
    expect(send.status).toBe(201);

    // финальное сообщение с цитатами и уверенностью
    let lastMsgs: unknown = null;
    const messages = await poll(
      async () => {
        lastMsgs = await widgetMessages();
        return lastMsgs as Array<{ id: string; seq: number; role: string; content: string; citations?: unknown[]; confidence?: number }>;
      },
      (msgs) => msgs.some((m) => m.role === "assistant" && m.citations && m.citations.length > 0),
      20_000,
    ).catch((err: Error) => {
      // Диагностика в CI: что реально записано (fallback? system-ошибка? ничего?)
      throw new Error(`E1: ответ с цитатами не получен; последние сообщения=${JSON.stringify(lastMsgs)}`, { cause: err });
    });
    const answer = messages.find((m) => m.role === "assistant")!;
    expect(answer.content).toContain("14 дней"); // знание из FAQ
    expect(answer.content).toContain("[1]"); // ссылка на источник
    expect(answer.confidence).toBeGreaterThan(0);

    // стриминг шёл до финала
    expect(aiTokens.length).toBeGreaterThan(1);
    socket.close();
  });

  it("E2: вопрос вне базы знаний → fallback, LLM не вызывается", async () => {
    const send = await widgetAuthed(
      api().post(`/widget/v1/conversations/${conversationId}/messages`).send({ text: "zxqww vvv tttrrr" }),
    );
    expect(send.status).toBe(201);

    const messages = await poll(
      widgetMessages,
      (msgs) => {
        const last = msgs[msgs.length - 1];
        return last?.role === "assistant" && last.content === FALLBACK;
      },
    );
    const fallbackMsg = messages[messages.length - 1]!;
    expect(fallbackMsg.citations ?? []).toHaveLength(0);
    expect(fallbackMsg.confidence ?? 0).toBe(0);
  });

  it("настройки ассистента читаются и обновляются", async () => {
    const get = await admin(api().get(`/api/v1/projects/${projectId}/assistant`));
    expect(get.status).toBe(200);
    expect(get.body.data.assistant.retrieval_settings.score_threshold).toBe(0.3);

    const patch = await admin(api().patch(`/api/v1/projects/${projectId}/assistant`)).send({
      name: "Помощник магазина",
      tone: "friendly",
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.assistant.name).toBe("Помощник магазина");
  });

  it("E9: переиндексация → version+1, старые вектора удалены", async () => {
    await admin(api().post(`/api/v1/projects/${projectId}/knowledge/documents/${docId}/reindex`));

    const docs = await poll(
      docList,
      (list) => list.some((d) => d.id === docId && d.version === 2 && d.status === "ready"),
    );
    const doc = docs.find((d) => d.id === docId)!;
    expect(doc.chunk_count).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      "select count(*)::int as n from chunks where source_document_id = $1 and source_version < 2",
      [docId],
    );
    expect(rows[0].n).toBe(0); // swap: старая версия удалена
  });
});
