/**
 * E2E Фазы 5 (docs/30 §Ф5, backend-часть Admin Panel):
 *   жизненный цикл сайта: create → list → patch → regenerate-key →
 *   старый ключ невалиден → 404 чужой проект → 403 без права;
 *   аналитика проекта: форма структуры после создания диалогов, clamp days;
 *   песочница: AI_PROVIDER=fake — детерминированный ответ, fallback вне KB,
 *   без записи в БД.
 * Запускается при DATABASE_URL (CI — сервис postgres).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";

const DB_URL = process.env.DATABASE_URL;
const SETUP_TOKEN = "e2e-setup-token-p5";
const SITE_ORIGIN = "https://p5.example.com";
const FALLBACK = "Нет точной информации — передаю оператору.";

describe.skipIf(!DB_URL)("e2e: сайты, аналитика, песочница (Фаза 5)", () => {
  let app: INestApplication;
  let pool: Pool;
  let projectId = "";
  let foreignSiteId = "";

  const ownerCookies: string[] = [];
  const opCookies: string[] = [];

  const api = () => request(app.getHttpServer());
  const owner = (req: request.Test) => req.set("Cookie", ownerCookies.join("; "));
  const op = (req: request.Test) => req.set("Cookie", opCookies.join("; "));

  const capture = (res: request.Response, jar: string[]): void => {
    const set = res.headers["set-cookie"];
    if (set) {
      jar.length = 0;
      jar.push(...(Array.isArray(set) ? set : [set]).map((c) => c.split(";")[0]));
    }
  };

  async function login(email: string, jar: string[]): Promise<void> {
    const res = await api().post("/api/v1/auth/login").send({ email, password: "password123" });
    expect(res.status).toBe(200);
    capture(res, jar);
  }

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

    await pool.query(
      "truncate table events, messages, handoffs, conversations, visitors, chunks, faqs, documents, escalation_rules, assistants, sites, project_members, projects, settings, users restart identity cascade",
    );

    // Владелец установки + проект
    const setup = await api().post("/api/v1/setup").send({
      token: SETUP_TOKEN,
      email: "owner@example.com",
      password: "password123",
      name: "Owner",
    });
    expect(setup.status).toBe(201);
    capture(setup, ownerCookies);

    const project = await owner(api().post("/api/v1/projects")).send({ name: "P5" });
    expect(project.status).toBe(201);
    projectId = project.body.data.project.id;

    // Ассистент с низким порогом гейта (fake-эмбеддинги детерминированы)
    await pool.query(
      `insert into assistants (project_id, retrieval_settings, safety_settings)
       values ($1, '{"top_k": 4, "score_threshold": 0.3, "history_depth": 6}'::jsonb, $2::jsonb)`,
      [projectId, JSON.stringify({ fallback_message: FALLBACK, denied_topics: [] })],
    );

    // Оператор проекта (не админ) — для проверок прав
    const u = await owner(api().post("/api/v1/users")).send({
      email: "op@example.com",
      password: "password123",
      name: "Оператор",
    });
    expect(u.status).toBe(201);
    const m = await owner(api().post(`/api/v1/projects/${projectId}/members`)).send({
      user_id: u.body.data.user.id,
      project_role: "operator",
    });
    expect(m.status).toBe(201);
    await login("op@example.com", opCookies);

    // Чужой проект без членств (изоляция siteId)
    const foreign = await pool.query("insert into projects (name) values ('Foreign') returning id");
    const foreignSite = await pool.query(
      `insert into sites (project_id, name, domain, allowed_origins, widget_public_key)
       values ($1, 'F', 'f.example.com', '[]'::jsonb, 'pk_foreign_p5_key') returning id`,
      [foreign.rows[0].id],
    );
    foreignSiteId = foreignSite.rows[0].id;

    // Провайдер: fake (детерминированные ответы — docs/18)
    await owner(api().put("/api/v1/settings/ai_provider.kind")).send({ value: "fake" });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  // --- A) REST сайтов ---

  it("создание сайта: ключ сгенерирован, событие site.created записано", async () => {
    const res = await owner(api().post(`/api/v1/projects/${projectId}/sites`)).send({
      name: "P5 Site",
      domain: "p5.example.com",
      allowed_origins: [SITE_ORIGIN],
      widget_config: { locale: "ru", theme: { accent: "#0066ff" } },
    });
    expect(res.status).toBe(201);
    const site = res.body.data.site;
    expect(site.project_id).toBe(projectId);
    expect(site.widget_public_key).toBeTruthy();
    expect(site.is_active).toBe(true);
    expect(site.allowed_origins).toEqual([SITE_ORIGIN]);

    const ev = await pool.query(
      "select count(*)::int as n from events where action = 'site.created' and entity_id = $1",
      [site.id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it("список сайтов проекта; оператору просмотр доступен, создание — нет", async () => {
    const list = await owner(api().get(`/api/v1/projects/${projectId}/sites`));
    expect(list.status).toBe(200);
    expect(list.body.data.sites).toHaveLength(1);
    expect(list.body.data.sites[0].domain).toBe("p5.example.com");

    const opList = await op(api().get(`/api/v1/projects/${projectId}/sites`));
    expect(opList.status).toBe(200); // просмотр — UseInbox

    const opCreate = await op(api().post(`/api/v1/projects/${projectId}/sites`)).send({
      name: "X",
      domain: "x.example.com",
      allowed_origins: [],
    });
    expect(opCreate.status).toBe(403);
    expect(opCreate.body.error.code).toBe("FORBIDDEN_PROJECT");
  });

  it("patch сайта: частичное обновление; пустой patch → ошибка валидации", async () => {
    const list = await owner(api().get(`/api/v1/projects/${projectId}/sites`));
    const siteId = list.body.data.sites[0].id as string;

    const patch = await owner(api().patch(`/api/v1/sites/${siteId}`)).send({
      name: "P5 Site v2",
      is_active: false,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.site.name).toBe("P5 Site v2");
    expect(patch.body.data.site.is_active).toBe(false);
    expect(patch.body.data.site.domain).toBe("p5.example.com"); // не тронуто

    const ev = await pool.query(
      "select count(*)::int as n from events where action = 'site.updated' and entity_id = $1",
      [siteId],
    );
    expect(ev.rows[0].n).toBe(1);

    // возвращаем активность — следующий тест проверяет виджет-init по ключу
    const restore = await owner(api().patch(`/api/v1/sites/${siteId}`)).send({ is_active: true });
    expect(restore.status).toBe(200);
    expect(restore.body.data.site.is_active).toBe(true);

    const empty = await owner(api().patch(`/api/v1/sites/${siteId}`)).send({});
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe("VALIDATION_FAILED");

    // не существующий siteId → 404
    const missing = await owner(api().patch(`/api/v1/sites/00000000-0000-0000-0000-000000000000`)).send({
      name: "ghost",
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("права на siteId-роуты: чужой проект → 404, членство без права → 403", async () => {
    // у оператора нет членства в чужом проекте → сайт неотличим от несуществующего
    const foreignPatch = await op(api().patch(`/api/v1/sites/${foreignSiteId}`)).send({ name: "hack" });
    expect(foreignPatch.status).toBe(404);
    expect(foreignPatch.body.error.code).toBe("NOT_FOUND");

    // оператор своего проекта видит сайт в списке, но управлять не может
    const ownSiteId = (await owner(api().get(`/api/v1/projects/${projectId}/sites`))).body.data.sites[0].id;
    const ownPatch = await op(api().patch(`/api/v1/sites/${ownSiteId}`)).send({ name: "nope" });
    expect(ownPatch.status).toBe(403);
    expect(ownPatch.body.error.code).toBe("FORBIDDEN_PROJECT");
  });

  it("regenerate-key: новый ключ работает, старый невалиден; событие записано", async () => {
    const list = await owner(api().get(`/api/v1/projects/${projectId}/sites`));
    const site = list.body.data.sites[0];
    const oldKey = site.widget_public_key as string;

    // старый ключ до ротации работал бы: init отвечает 200
    const before = await api().post("/widget/v1/init").set("Origin", SITE_ORIGIN).send({
      key: oldKey,
      anon_id: "anon-p5-prekey-1",
    });
    expect(before.status).toBe(200);

    const regen = await owner(api().post(`/api/v1/sites/${site.id}/regenerate-key`));
    expect(regen.status).toBe(201);
    const newKey = regen.body.data.site.widget_public_key as string;
    expect(newKey).toBeTruthy();
    expect(newKey).not.toBe(oldKey);

    // старый ключ больше не находит сайт (перезапись колонки)
    const stale = await api().post("/widget/v1/init").set("Origin", SITE_ORIGIN).send({
      key: oldKey,
      anon_id: "anon-p5-oldkey-1",
    });
    expect(stale.status).toBe(404);

    // новый ключ работает
    const fresh = await api().post("/widget/v1/init").set("Origin", SITE_ORIGIN).send({
      key: newKey,
      anon_id: "anon-p5-newkey-1",
    });
    expect(fresh.status).toBe(200);

    const ev = await pool.query(
      "select count(*)::int as n from events where action = 'site.key_regenerated' and entity_id = $1",
      [site.id],
    );
    expect(ev.rows[0].n).toBe(1);
  });

  // --- B) Аналитика проекта ---

  async function seedAnalyticsData(): Promise<void> {
    const site = (
      await pool.query("select id from sites where project_id = $1 limit 1", [projectId])
    ).rows[0];
    const visitor = await pool.query(
      "insert into visitors (project_id, anon_id) values ($1, 'anon-p5-analytics') returning id",
      [projectId],
    );

    // Диалог №1: сегодня, visitor → fallback (assistant c confidence=NULL) — пара низкой релевантности
    const conv1 = await pool.query(
      `insert into conversations (project_id, site_id, visitor_id, state)
       values ($1, $2, $3, 'AI_ACTIVE') returning id`,
      [projectId, site.id, visitor.rows[0].id],
    );
    await pool.query(
      `insert into messages (conversation_id, seq, role, content) values ($1, 1, 'visitor', 'какая стоимость доставки в отдалённый регион')`,
      [conv1.rows[0].id],
    );
    await pool.query(
      `insert into messages (conversation_id, seq, role, content, confidence) values ($1, 2, 'assistant', $2, null)`,
      [conv1.rows[0].id, FALLBACK],
    );

    // Диалог №2: сегодня, visitor → ответ ассистента с низкой уверенностью (< 0.5) + handoff
    const conv2 = await pool.query(
      `insert into conversations (project_id, site_id, visitor_id, state)
       values ($1, $2, $3, 'WAITING_OPERATOR') returning id`,
      [projectId, site.id, visitor.rows[0].id],
    );
    await pool.query(
      `insert into messages (conversation_id, seq, role, content) values ($1, 1, 'visitor', 'верните деньги за заказ')`,
      [conv2.rows[0].id],
    );
    await pool.query(
      `insert into messages (conversation_id, seq, role, content, confidence) values ($1, 2, 'assistant', 'Не уверен в ответе.', 0.32)`,
      [conv2.rows[0].id],
    );
    await pool.query(
      `insert into handoffs (conversation_id, reason, requested_by, status) values ($1, 'low_confidence', 'ai', 'pending')`,
      [conv2.rows[0].id],
    );

    // Диалог №3: позавчера, без handoff (разрешён AI) — попадает в дневной ряд
    await pool.query(
      `insert into conversations (project_id, site_id, visitor_id, state, created_at, updated_at)
       values ($1, $2, $3, 'RESOLVED', now() - interval '2 days', now() - interval '2 days')`,
      [projectId, site.id, visitor.rows[0].id],
    );
  }

  it("аналитика: структура ответа и значения после создания диалогов", async () => {
    await seedAnalyticsData();

    const res = await owner(api().get(`/api/v1/projects/${projectId}/analytics?days=14`));
    expect(res.status).toBe(200);
    const a = res.body.data.analytics;

    expect(a.days).toHaveLength(14);
    // ряд упорядочен по возрастанию и заканчивается сегодняшним днём.
    // «Сегодня» берём SQL-ом (аудит IR-059: дата из Node-раннера флейовала,
    // если TZ раннера не совпадает с TZ контейнера БД на границе суток)
    const todayRows = await pool.query<{ d: string }>("select to_char(now(), 'YYYY-MM-DD') as d");
    expect(a.days.at(-1).date).toBe(todayRows.rows[0]!.d);
    for (const day of a.days) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.conversations).toBeGreaterThanOrEqual(0);
      expect(day.messages).toBeGreaterThanOrEqual(0);
      expect(day.handoffs).toBeGreaterThanOrEqual(0);
    }
    // позавчерашний диалог попал в свой день
    expect(a.days[11].conversations).toBeGreaterThanOrEqual(1);
    // сегодняшний день: 2 диалога, 4 сообщения, 1 handoff
    expect(a.days.at(-1).conversations).toBe(2);
    expect(a.days.at(-1).messages).toBe(4);
    expect(a.days.at(-1).handoffs).toBe(1);

    expect(a.totals.conversations).toBe(3);
    expect(a.totals.handoffs).toBe(1);
    expect(a.totals.handoff_rate).toBeCloseTo(1 / 3, 3);
    // 2 из 3 диалогов без единого handoff
    expect(a.totals.ai_resolved_share).toBeCloseTo(2 / 3, 3);
    // первый ответ ассистента есть только у диалогов с парой visitor→assistant
    expect(a.totals.avg_first_response_ms).not.toBeNull();

    // топ низкой релевантности: оба «неудачных» вопроса
    const texts = a.low_relevance_top.map((i: { text: string }) => i.text);
    expect(texts.some((t: string) => t.includes("стоимость доставки"))).toBe(true);
    expect(texts.some((t: string) => t.includes("верните деньги"))).toBe(true);

    // оператору просмотр доступен (UseInbox)
    const opView = await op(api().get(`/api/v1/projects/${projectId}/analytics`));
    expect(opView.status).toBe(200);
  });

  it("аналитика: clamp days 1..90; нечисловой days → ошибка валидации", async () => {
    const big = await owner(api().get(`/api/v1/projects/${projectId}/analytics?days=500`));
    expect(big.status).toBe(200);
    expect(big.body.data.analytics.days).toHaveLength(90);

    const small = await owner(api().get(`/api/v1/projects/${projectId}/analytics?days=0`));
    expect(small.status).toBe(200);
    expect(small.body.data.analytics.days).toHaveLength(1);

    const bad = await owner(api().get(`/api/v1/projects/${projectId}/analytics?days=abc`));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
  });

  // --- C) Песочница тестового диалога ---

  it("песочница: вопрос по базе знаний → детерминированный ответ fake-AI с цитатами", async () => {
    // Индексация FAQ синхронна (knowledge.service)
    const faq = await owner(api().post(`/api/v1/projects/${projectId}/knowledge/faqs`)).send({
      question: "Сколько стоит доставка?",
      answer: "Доставка по городу стоит 500 рублей и занимает два дня.",
    });
    expect(faq.status).toBe(201);

    const res = await owner(api().post(`/api/v1/projects/${projectId}/sandbox/messages`)).send({
      text: "сколько стоит доставка?",
    });
    expect(res.status, `sandbox in-kb failed: ${JSON.stringify(res.body)}`).toBe(201);
    const answer = res.body.data.answer;
    expect(answer.fallback).toBe(false);
    expect(answer.confidence).toBeGreaterThan(0); // fake: 0.87
    expect(Array.isArray(answer.citations)).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(typeof answer.text).toBe("string");
    expect(answer.text.length).toBeGreaterThan(0);
  });

  it("песочница: вопрос вне базы знаний → fallback без записи в БД", async () => {
    const countSql = `select
         (select count(*)::int from conversations where project_id = $1) as convs,
         (select count(*)::int from messages m join conversations c on c.id = m.conversation_id where c.project_id = $1) as msgs,
         (select count(*)::int from handoffs h join conversations c on c.id = h.conversation_id where c.project_id = $1) as handoffs`;
    const before = await pool.query(countSql, [projectId]);

    const res = await owner(api().post(`/api/v1/projects/${projectId}/sandbox/messages`)).send({
      text: "zxqww vvv tttrrr",
    });
    expect(res.status, `sandbox out-kb failed: ${JSON.stringify(res.body)}`).toBe(201);
    const answer = res.body.data.answer;
    expect(answer.fallback).toBe(true);
    expect(answer.text).toBe(FALLBACK);
    expect(answer.confidence).toBeNull();
    expect(answer.citations).toEqual([]);

    const after = await pool.query(countSql, [projectId]);
    expect(after.rows[0]).toEqual(before.rows[0]); // ни одной записи

    // валидация тела
    const bad = await owner(api().post(`/api/v1/projects/${projectId}/sandbox/messages`)).send({ text: "" });
    expect(bad.status).toBe(422);

    // право ManageProject: оператору нельзя
    const denied = await op(api().post(`/api/v1/projects/${projectId}/sandbox/messages`)).send({ text: "привет" });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN_PROJECT");
  });
});
