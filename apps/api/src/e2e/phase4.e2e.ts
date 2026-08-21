/**
 * E2E Фазы 4 (docs/30 §3, критерии приёмки):
 *   E3 «позовите менеджера» → очередь → accept → ответ оператора;
 *   E4 low_confidence → авто-эскалация по правилу RulesEngine;
 *   E6 возврат чата AI → AI отвечает с контекстом;
 *   E7 офлайн → leave-email заявка;
 *   гонка двух операторов → второй получает 409; незаконные переходы → 409;
 *   заметки (role=note) не видны посетителю; изоляция проектов;
 *   namespace /admin: подписка и пуш очереди.
 * Запускается при DATABASE_URL (CI — сервис postgres).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";

const DB_URL = process.env.DATABASE_URL;
const SITE_KEY = "pk_test_e2e_widget_p4";
const GOOD_ORIGIN = "https://p4.example.com";

describe.skipIf(!DB_URL)("e2e: эскалация и операторы (Фаза 4)", () => {
  let app: INestApplication;
  let pool: Pool;
  let port = 0;
  let projectId = "";

  const ownerCookies: string[] = [];
  const op1Cookies: string[] = [];
  const op2Cookies: string[] = [];
  let op1Id = "";

  let visitorToken = "";
  let convId = ""; // основной диалог E3→E6
  let convE4 = "";
  let convE7 = "";
  let foreignConvId = ""; // чужой проект для изоляции

  const baseUrl = () => `http://127.0.0.1:${port}`;

  const withCookies = (jar: string[]) => (req: request.Test): request.Test =>
    jar.length ? req.set("Cookie", jar.join("; ")) : req;
  const owner = (req: request.Test) => withCookies(ownerCookies)(req);
  const op1 = (req: request.Test) => withCookies(op1Cookies)(req);

  const capture = (res: request.Response, jar: string[]): void => {
    const set = res.headers["set-cookie"];
    if (set) {
      jar.length = 0;
      jar.push(...(Array.isArray(set) ? set : [set]).map((c) => c.split(";")[0]));
    }
  };

  async function login(email: string, jar: string[]): Promise<void> {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "password123" });
    expect(res.status).toBe(200);
    capture(res, jar);
  }

  // --- хелперы виджет-зоны ---
  async function initVisitor(anonId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/widget/v1/init")
      .set("Origin", GOOD_ORIGIN)
      .send({ key: SITE_KEY, anon_id: anonId });
    expect(res.status).toBe(200);
    return res.body.data.visitor_token as string;
  }

  async function createConversation(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/widget/v1/conversations")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(201);
    return res.body.data.conversation.id as string;
  }

  async function sendVisitorMessage(
    token: string,
    conversationId: string,
    text: string,
    key: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/widget/v1/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ text });
  }

  async function pollMessages(
    token: string,
    conversationId: string,
    afterSeq: number,
    expectMin: number,
    timeoutMs = 5000,
  ): Promise<Array<{ seq: number; role: string; content: string }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await request(app.getHttpServer())
        .get(`/widget/v1/conversations/${conversationId}/messages?after_seq=${afterSeq}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      if (res.body.data.messages.length >= expectMin) return res.body.data.messages;
      if (Date.now() > deadline) throw new Error("timeout waiting for messages");
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_SECRET = process.env.APP_SECRET ?? "e2e-app-secret-0123456789";
    process.env.SETUP_TOKEN = "e2e-setup-token-p4";

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

    // Владелец + проект + сайт
    const setup = await request(app.getHttpServer())
      .post("/api/v1/setup")
      .send({ token: "e2e-setup-token-p4", email: "owner@example.com", password: "password123", name: "Owner" });
    expect(setup.status).toBe(201);
    capture(setup, ownerCookies);

    const project = await owner(request(app.getHttpServer()).post("/api/v1/projects")).send({ name: "P4" });
    projectId = project.body.data.project.id;
    await pool.query(
      `insert into sites (project_id, name, domain, allowed_origins, widget_public_key, widget_config)
       values ($1, 'P4 site', 'p4.example.com', $2::jsonb, $3, '{}::jsonb')`,
      [projectId, JSON.stringify([GOOD_ORIGIN]), SITE_KEY],
    );

    // Два оператора проекта
    for (const [email, name] of [
      ["op1@example.com", "Оператор 1"],
      ["op2@example.com", "Оператор 2"],
    ] as const) {
      const u = await owner(request(app.getHttpServer()).post("/api/v1/users")).send({
        email,
        password: "password123",
        name,
      });
      expect(u.status).toBe(201);
      const id = u.body.data.user.id as string;
      if (email.startsWith("op1")) op1Id = id;
      const m = await owner(
        request(app.getHttpServer()).post(`/api/v1/projects/${projectId}/members`),
      ).send({ user_id: id, project_role: "operator" });
      expect(m.status).toBe(201);
    }
    await login("op1@example.com", op1Cookies);
    await login("op2@example.com", op2Cookies);

    // Чужой проект с диалогом (изоляция)
    const foreign = await pool.query("insert into projects (name) values ('Foreign') returning id");
    const foreignSite = await pool.query(
      `insert into sites (project_id, name, domain, allowed_origins, widget_public_key)
       values ($1, 'F', 'f.example.com', '[]::jsonb', 'pk_foreign_key_0001') returning id`,
      [foreign.rows[0].id],
    );
    const fVisitor = await pool.query(
      "insert into visitors (project_id, anon_id) values ($1, 'anon-f') returning id",
      [foreign.rows[0].id],
    );
    const fConv = await pool.query(
      `insert into conversations (project_id, site_id, visitor_id, state)
       values ($1, $2, $3, 'AI_ACTIVE') returning id`,
      [foreign.rows[0].id, foreignSite.rows[0].id, fVisitor.rows[0].id],
    );
    foreignConvId = fConv.rows[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("E3: явная просьба → WAITING_OPERATOR, офлайн-подсказка, запись в очереди", async () => {
    visitorToken = await initVisitor("anon-p4-main-1");
    convId = await createConversation(visitorToken);
    const sent = await sendVisitorMessage(visitorToken, convId, "Привет", "p4-m1");
    expect(sent.status).toBe(201);
    await pollMessages(visitorToken, convId, 1, 1); // fake-AI ответил

    const handoff = await request(app.getHttpServer())
      .post(`/widget/v1/conversations/${convId}/handoff`)
      .set("Authorization", `Bearer ${visitorToken}`);
    expect(handoff.status).toBe(200);

    const state = await request(app.getHttpServer())
      .get(`/widget/v1/conversations/${convId}`)
      .set("Authorization", `Bearer ${visitorToken}`);
    expect(state.body.data.conversation.state).toBe("WAITING_OPERATOR");

    // операторов онлайн нет (presence пуст) → предложение оставить email (docs/13 §4)
    const msgs = await pollMessages(visitorToken, convId, 2, 2);
    const contents = msgs.map((m) => m.content).join("\n");
    expect(contents).toContain("операторы не в сети");

    // очередь видна оператору
    const queue = await op1(request(app.getHttpServer()).get("/api/v1/handoffs?status=pending"));
    expect(queue.status).toBe(200);
    const entry = queue.body.data.handoffs.find(
      (h: { conversation_id: string }) => h.conversation_id === convId,
    );
    expect(entry).toBeTruthy();
    expect(entry.reason).toBe("explicit_request");
  });

  it("E3: accept → OPERATOR_ACTIVE; ответ оператора доходит посетителю; AI молчит", async () => {
    const accept = await op1(request(app.getHttpServer()).post(`/api/v1/conversations/${convId}/accept`));
    expect(accept.status).toBe(201);
    expect(accept.body.data.conversation.state).toBe("OPERATOR_ACTIVE");
    expect(accept.body.data.conversation.assigned_operator_id).toBe(op1Id);

    const reply = await op1(
      request(app.getHttpServer()).post(`/api/v1/conversations/${convId}/messages`),
    ).send({ text: "Здравствуйте! Я оператор, чем помочь?" });
    expect(reply.status).toBe(201);
    expect(reply.body.data.message.role).toBe("operator");

    const msgs = await pollMessages(visitorToken, convId, 0, 4);
    expect(msgs.some((m) => m.role === "operator")).toBe(true);

    // AI не отвечает в OPERATOR_ACTIVE (docs/13 «Частые ошибки»)
    await new Promise((r) => setTimeout(r, 700));
    const after = await request(app.getHttpServer())
      .get(`/widget/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${visitorToken}`);
    const last = after.body.data.messages.at(-1);
    expect(last.role).toBe("operator");
  });

  it("заметка (role=note) видна панели, но не посетителю", async () => {
    const note = await op1(
      request(app.getHttpServer()).post(`/api/v1/conversations/${convId}/messages`),
    ).send({ text: "Внутренняя заметка: проверьте заказ", is_note: true });
    expect(note.status).toBe(201);
    expect(note.body.data.message.role).toBe("note");

    const adminView = await op1(request(app.getHttpServer()).get(`/api/v1/conversations/${convId}/messages`));
    expect(adminView.body.data.messages.some((m: { role: string }) => m.role === "note")).toBe(true);

    const widgetView = await request(app.getHttpServer())
      .get(`/widget/v1/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${visitorToken}`);
    expect(widgetView.body.data.messages.some((m: { role: string }) => m.role === "note")).toBe(false);
  });

  it("гонка: второй оператор на принятый диалог → 409; ответ в WAITING_OPERATOR → 409", async () => {
    // свежий диалог в WAITING_OPERATOR
    const t = await initVisitor("anon-p4-race-1");
    const c = await createConversation(t);
    await sendVisitorMessage(t, c, "хочу человека", "p4-race-1");
    await request(app.getHttpServer())
      .post(`/widget/v1/conversations/${c}/handoff`)
      .set("Authorization", `Bearer ${t}`);

    const first = await op1(request(app.getHttpServer()).post(`/api/v1/conversations/${c}/accept`));
    expect(first.status).toBe(201);
    const second = await withCookies(op2Cookies)(
      request(app.getHttpServer()).post(`/api/v1/conversations/${c}/accept`),
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("INVALID_STATE_TRANSITION");

    // незаконные переходы: reopen из OPERATOR_ACTIVE запрещён
    const reopenWrong = await op1(request(app.getHttpServer()).post(`/api/v1/conversations/${c}/reopen`));
    expect(reopenWrong.status).toBe(409);
    expect(reopenWrong.body.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("ответ оператора запрещён вне OPERATOR_ACTIVE (409)", async () => {
    const t = await initVisitor("anon-p4-silent-1");
    const c = await createConversation(t);
    await sendVisitorMessage(t, c, "вопрос к AI", "p4-silent-1");
    await pollMessages(t, c, 1, 1); // AI_ACTIVE

    const res = await op1(request(app.getHttpServer()).post(`/api/v1/conversations/${c}/messages`)).send({
      text: "рано",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("E4: low_confidence → авто-эскалация по правилу (rule_id записан)", async () => {
    // дефолтные правила созданы движком при первом AI-ходе
    const list = await owner(
      request(app.getHttpServer()).get(`/api/v1/projects/${projectId}/assistant/rules`),
    );
    expect(list.status).toBe(200);
    const rules = list.body.data.rules as Array<{
      id: string;
      type: string;
      params: Record<string, unknown>;
    }>;
    const low = rules.find((r) => r.type === "low_confidence");
    expect(low).toBeTruthy();

    // fake-провайдер даёт confidence 0.87 → поднимаем порог, чтобы правило сработало
    const patch = await owner(
      request(app.getHttpServer()).patch(`/api/v1/projects/${projectId}/assistant/rules/${low!.id}`),
    ).send({ params: { threshold: 0.99 } });
    expect(patch.status).toBe(200);

    const t = await initVisitor("anon-p4-e4-1");
    convE4 = await createConversation(t);
    await sendVisitorMessage(t, convE4, "доставка?", "p4-e4-1");
    await pollMessages(t, convE4, 1, 1); // AI-ход с низкой (для правила) уверенностью

    const state = await request(app.getHttpServer())
      .get(`/widget/v1/conversations/${convE4}`)
      .set("Authorization", `Bearer ${t}`);
    expect(state.body.data.conversation.state).toBe("WAITING_OPERATOR");

    const card = await owner(request(app.getHttpServer()).get(`/api/v1/conversations/${convE4}`));
    expect(card.body.data.conversation.handoff.reason).toBe("low_confidence");
    expect(card.body.data.conversation.handoff.rule_id).toBe(low!.id);
  });

  it("E6: возврат чата AI → AI отвечает с контекстом после сообщений оператора", async () => {
    const back = await op1(request(app.getHttpServer()).post(`/api/v1/conversations/${convId}/return-to-ai`));
    expect(back.status).toBe(201);
    expect(back.body.data.conversation.state).toBe("AI_ACTIVE");

    // посетитель пишет снова — AI отвечает (история содержит сообщения оператора)
    const sent = await sendVisitorMessage(visitorToken, convId, "спасибо, уточню доставку", "p4-m2");
    expect(sent.status).toBe(201);
    const msgs = await pollMessages(visitorToken, convId, sent.body.data.message.seq - 1, 2);
    expect(msgs.map((m) => m.role)).toContain("assistant");
  });

  it("E7: офлайн-заявка leave-email → RESOLVED, лид в контексте и events", async () => {
    const t = await initVisitor("anon-p4-e7-1");
    convE7 = await createConversation(t);
    await sendVisitorMessage(t, convE7, "есть вопрос", "p4-e7-1");
    await pollMessages(t, convE7, 1, 1);
    await request(app.getHttpServer())
      .post(`/widget/v1/conversations/${convE7}/handoff`)
      .set("Authorization", `Bearer ${t}`);

    const email = await request(app.getHttpServer())
      .post(`/widget/v1/conversations/${convE7}/leave-email`)
      .set("Authorization", `Bearer ${t}`)
      .send({ email: "lead@example.com", name: "Иван" });
    expect(email.status).toBe(201);

    const state = await request(app.getHttpServer())
      .get(`/widget/v1/conversations/${convE7}`)
      .set("Authorization", `Bearer ${t}`);
    expect(state.body.data.conversation.state).toBe("RESOLVED");

    const ctx = await pool.query("select context from conversations where id = $1", [convE7]);
    expect(ctx.rows[0].context.leave_email).toBe("lead@example.com");

    const ev = await pool.query(
      "select count(*)::int as n from events where action = 'lead.captured' and entity_id = $1",
      [convE7],
    );
    expect(ev.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("изоляция: оператор чужого проекта → 403 FORBIDDEN_PROJECT; владелец видит", async () => {
    const forbidden = await op1(request(app.getHttpServer()).get(`/api/v1/conversations/${foreignConvId}`));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_PROJECT");

    const ok = await owner(request(app.getHttpServer()).get(`/api/v1/conversations/${foreignConvId}`));
    expect(ok.status).toBe(200);
  });

  it("namespace /admin: подписка проекта, пуш handoff:created и presence", async () => {
    // access-JWT берём из cookie сессии владельца (тот же токен)
    const accessCookie = ownerCookies.find((c) => c.startsWith("unichat_access="));
    expect(accessCookie).toBeTruthy();
    const accessToken = accessCookie!.split("=")[1];

    const socket: Socket = io(`${baseUrl()}/admin`, {
      auth: { token: accessToken },
      transports: ["websocket"],
      reconnection: false,
    });

    const subscribed = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
      socket.io.on("open", () => {
        socket.emit(
          "admin:subscribe_project",
          { project_id: projectId },
          (r: { ok: boolean; error?: string }) => resolve(r),
        );
      });
      socket.on("connect_error", (err) => reject(err));
      setTimeout(() => reject(new Error("admin connect timeout")), 5000);
    });
    expect(subscribed.ok).toBe(true);

    const gotHandoff = new Promise<{ conversation_id: string; reason: string }>((resolve, reject) => {
      socket.on("handoff:created", (p: { conversation_id: string; reason: string }) => resolve(p));
      setTimeout(() => reject(new Error("no handoff:created push")), 6000);
    });

    // новый handoff при подключённом операторе (он теперь online → без офлайн-фразы)
    const t = await initVisitor("anon-p4-sock-1");
    const c = await createConversation(t);
    await sendVisitorMessage(t, c, "позовите, пожалуйста", "p4-sock-1");
    await pollMessages(t, c, 1, 1);
    await request(app.getHttpServer())
      .post(`/widget/v1/conversations/${c}/handoff`)
      .set("Authorization", `Bearer ${t}`);

    const pushed = await gotHandoff;
    expect(pushed.conversation_id).toBe(c);
    expect(pushed.reason).toBe("explicit_request");

    // presence: подписчик получил operator:presence с online_count >= 1
    const presence = await new Promise<number>((resolve, reject) => {
      socket.on("operator:presence", (p: { online_count: number }) => resolve(p.online_count));
      setTimeout(() => reject(new Error("no operator:presence push")), 5000);
    });
    expect(presence).toBeGreaterThanOrEqual(1);

    socket.close();
  });
});
