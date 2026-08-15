/**
 * E2E Фазы 2 (docs/30 §3, критерии приёмки):
 *   init (origin allowlist → visitor JWT), диалог, seq-порядок, after_seq-кэтч-ап,
 *   rate limit, изоляция владельца, Socket.IO join + push + reconnect-кэтч-ап.
 * Запускается при DATABASE_URL (CI — сервис postgres).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { io, type Socket } from "socket.io-client";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";

const DB_URL = process.env.DATABASE_URL;
const SITE_KEY = "pk_test_e2e_widget_key_9f3a";
const GOOD_ORIGIN = "https://example.com";

describe.skipIf(!DB_URL)("e2e: widget zone /widget/v1 (Фаза 2)", () => {
  let app: INestApplication;
  let pool: Pool;
  let port = 0;
  let visitorToken = "";
  let conversationId = "";

  const baseUrl = () => `http://127.0.0.1:${port}`;

  const authed = (req: request.Test) => req.set("Authorization", `Bearer ${visitorToken}`);

  async function pollMessages(afterSeq = 0, expectMin: number, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await authed(
        request(app.getHttpServer()).get(
          `/widget/v1/conversations/${conversationId}/messages?after_seq=${afterSeq}`,
        ),
      );
      expect(res.status).toBe(200);
      if (res.body.data.messages.length >= expectMin) return res.body.data.messages;
      if (Date.now() > deadline) throw new Error("timeout waiting for messages");
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_SECRET = process.env.APP_SECRET ?? "e2e-app-secret-0123456789";

    pool = new Pool({ connectionString: DB_URL });

    const { AppModule } = await import("../app.module");
    const { NestFactory } = await import("@nestjs/core");
    const { configureApp } = await import("../common/app-setup");

    app = await NestFactory.create(AppModule, { bufferLogs: true });
    configureApp(app);
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;

    // Чистые данные: проект + сайт напрямую (admin-UI сайтов — Фаза 5)
    await pool.query(
      "truncate table events, messages, handoffs, conversations, visitors, chunks, faqs, documents, escalation_rules, assistants, sites, project_members, projects, settings, users restart identity cascade",
    );
    const { rows: projectRows } = await pool.query(
      "insert into projects (name) values ('Widget E2E') returning id",
    );
    await pool.query(
      `insert into sites (project_id, name, domain, allowed_origins, widget_public_key, widget_config)
       values ($1, 'E2E site', 'example.com', $2::jsonb, $3, $4::jsonb)`,
      [
        projectRows[0].id,
        JSON.stringify([GOOD_ORIGIN]),
        SITE_KEY,
        JSON.stringify({
          locale: "ru",
          theme: { accent: "#123456", position: "right" },
          texts: { greeting: "Привет из e2e!" },
        }),
      ],
    );
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("health зоны виджета публичен", async () => {
    const res = await request(app.getHttpServer()).get("/widget/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
  });

  it("init: валидные ключ+origin → visitor token и конфиг виджета", async () => {
    const res = await request(app.getHttpServer())
      .post("/widget/v1/init")
      .set("Origin", GOOD_ORIGIN)
      .send({ key: SITE_KEY, anon_id: "anon-visitor-a-0001" });
    expect(res.status).toBe(200);
    expect(res.body.data.visitor_token).toBeTruthy();
    expect(res.body.data.widget.locale).toBe("ru");
    expect(res.body.data.widget.theme.accent).toBe("#123456");
    expect(res.body.data.conversation).toBeNull();
    visitorToken = res.body.data.visitor_token;
  });

  it("init: чужой origin → 403 INVALID_ORIGIN", async () => {
    const res = await request(app.getHttpServer())
      .post("/widget/v1/init")
      .set("Origin", "https://evil.example")
      .send({ key: SITE_KEY, anon_id: "anon-visitor-x-0001" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("INVALID_ORIGIN");
  });

  it("init: неизвестный ключ → 404; без origin → 403", async () => {
    const bad = await request(app.getHttpServer())
      .post("/widget/v1/init")
      .set("Origin", GOOD_ORIGIN)
      .send({ key: "pk_live_unknown_key_0", anon_id: "anon-visitor-b-0001" });
    expect(bad.status).toBe(404);

    const noOrigin = await request(app.getHttpServer())
      .post("/widget/v1/init")
      .send({ key: SITE_KEY, anon_id: "anon-visitor-c-0001" });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.error.code).toBe("INVALID_ORIGIN");
  });

  it("создание диалога → NEW; первое сообщение → AI_ACTIVE (fake-AI отвечает)", async () => {
    const create = await authed(request(app.getHttpServer()).post("/widget/v1/conversations"));
    expect(create.status).toBe(201);
    conversationId = create.body.data.conversation.id;
    expect(create.body.data.conversation.state).toBe("NEW");

    const send = await authed(
      request(app.getHttpServer())
        .post(`/widget/v1/conversations/${conversationId}/messages`)
        .set("Idempotency-Key", "e2e-key-msg-1")
        .send({ text: "Привет, это тест" }),
    );
    expect(send.status).toBe(201);
    expect(send.body.data.message.seq).toBe(1);
    expect(send.body.data.message.role).toBe("visitor");

    // идемпотентность: повтор того же ключа → то же сообщение, без дубля
    const replay = await authed(
      request(app.getHttpServer())
        .post(`/widget/v1/conversations/${conversationId}/messages`)
        .set("Idempotency-Key", "e2e-key-msg-1")
        .send({ text: "Привет, это тест" }),
    );
    expect(replay.status).toBe(201);
    expect(replay.body.data.message.id).toBe(send.body.data.message.id);

    // fake-AI (заглушка Фазы 2) отвечает
    const messages = await pollMessages(0, 2);
    expect(messages.map((m: { role: string }) => m.role)).toEqual(["visitor", "assistant"]);
    expect(messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2]);

    const state = await authed(
      request(app.getHttpServer()).get(`/widget/v1/conversations/${conversationId}`),
    );
    expect(state.body.data.conversation.state).toBe("AI_ACTIVE");
  });

  it("кэтч-ап after_seq: возвращает только новые сообщения", async () => {
    const newer = await pollMessages(1, 1);
    expect(newer).toHaveLength(1);
    expect(newer[0].seq).toBe(2);
  });

  it("изоляция: чужой посетитель не читает диалог (404)", async () => {
    const strangerInit = await request(app.getHttpServer())
      .post("/widget/v1/init")
      .set("Origin", GOOD_ORIGIN)
      .send({ key: SITE_KEY, anon_id: "anon-visitor-stranger-1" });
    const strangerToken = strangerInit.body.data.visitor_token;

    const res = await request(app.getHttpServer())
      .get(`/widget/v1/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toBe(404);
  });

  it("Socket.IO: join → push сообщения; reconnect → кэтч-ап after_seq (E5)", async () => {
    const socket: Socket = io(`${baseUrl()}/widget`, {
      auth: { token: visitorToken },
      transports: ["websocket"],
      reconnection: false,
    });

    const joined = await new Promise<{ ok: boolean }>((resolve, reject) => {
      socket.io.on("open", () => {
        socket.emit("widget:join", { conversation_id: conversationId }, (r: { ok: boolean }) =>
          resolve(r),
        );
      });
      socket.on("connect_error", (err) => reject(err));
      setTimeout(() => reject(new Error("join timeout")), 5000);
    });
    expect(joined.ok).toBe(true);

    const received: Array<{ seq: number; role: string }> = [];
    socket.on("message", (m: { seq: number; role: string }) => received.push(m));

    // сообщение при подключённом сокете приходит пушем
    await authed(
      request(app.getHttpServer())
        .post(`/widget/v1/conversations/${conversationId}/messages`)
        .set("Idempotency-Key", "e2e-key-msg-sock-1")
        .send({ text: "сокет-тест" }),
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no push via socket")), 5000);
      const check = () => {
        if (received.some((m) => m.role === "visitor" && m.seq === 3)) {
          clearTimeout(t);
          resolve();
        } else setTimeout(check, 100);
      };
      check();
    });

    // детерминизм: ждём fake-AI ответ (seq4) ДО разрыва соединения
    await pollMessages(3, 1);

    // разрыв → сообщения уходят мимо сокета → reconnect → добор по after_seq
    socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    await authed(
      request(app.getHttpServer())
        .post(`/widget/v1/conversations/${conversationId}/messages`)
        .set("Idempotency-Key", "e2e-key-msg-sock-2")
        .send({ text: "оффлайн-сообщение" }),
    );
    await new Promise((r) => setTimeout(r, 800)); // ждём fake-AI (seq6)

    // пропущенное при разрыве: seq5 (посетитель) + seq6 (fake-AI) — кэтч-ап after_seq
    const lastSeen = 4;
    const missed = await pollMessages(lastSeen, 2);
    expect(missed.map((m: { seq: number }) => m.seq)).toEqual([5, 6]);
    expect(missed.map((m: { role: string }) => m.role)).toEqual(["visitor", "assistant"]);

    socket.close();
  });

  it("rate limit: 11-е сообщение в минуту → 429 RATE_LIMITED", async () => {
    // свежий посетитель → чистый бакет
    const fresh = await request(app.getHttpServer())
      .post("/widget/v1/init")
      .set("Origin", GOOD_ORIGIN)
      .send({ key: SITE_KEY, anon_id: "anon-visitor-rl-00001" });
    const token = fresh.body.data.visitor_token;
    const conv = await request(app.getHttpServer())
      .post("/widget/v1/conversations")
      .set("Authorization", `Bearer ${token}`);
    const convId = conv.body.data.conversation.id;

    let last = null as unknown as request.Response;
    for (let i = 1; i <= 11; i++) {
      last = await request(app.getHttpServer())
        .post(`/widget/v1/conversations/${convId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", `e2e-key-rl-${i}`)
        .send({ text: `спам-${i}` });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe("RATE_LIMITED");
    expect(last!.body.error.details.retry_after_s).toBeGreaterThan(0);
  });

  it("handoff: явная просьба → WAITING_OPERATOR + системное сообщение", async () => {
    const res = await authed(
      request(app.getHttpServer()).post(`/widget/v1/conversations/${conversationId}/handoff`),
    );
    expect(res.status).toBe(200);

    const state = await authed(
      request(app.getHttpServer()).get(`/widget/v1/conversations/${conversationId}`),
    );
    expect(state.body.data.conversation.state).toBe("WAITING_OPERATOR");

    const messages = await authed(
      request(app.getHttpServer()).get(`/widget/v1/conversations/${conversationId}/messages`),
    );
    const systemMsgs = messages.body.data.messages.filter(
      (m: { role: string }) => m.role === "system",
    );
    expect(systemMsgs.length).toBeGreaterThanOrEqual(1);
  });
});
