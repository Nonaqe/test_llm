/**
 * E2E Фазы 1 (docs/30 §3, критерии приёмки):
 *   логин → me → CRUD проекта; чужой проект → 403; brute-force → 429;
 *   ротация refresh; настройки с шифрованием секрета.
 * Запускается только при DATABASE_URL (CI — сервис postgres; локально — pnpm dev:db).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { Pool } from "pg";

const DB_URL = process.env.DATABASE_URL;
const SETUP_TOKEN = "e2e-setup-token-42";

describe.skipIf(!DB_URL)("e2e: auth + projects + изоляция (Фаза 1)", () => {
  let app: INestApplication;
  let pool: Pool;
  let cookies: string[] = [];
  let projectId = "";

  // supertest: .set доступен только после HTTP-глагола — оборачиваем глаголы
  const withCookies = (req: request.Test): request.Test =>
    cookies.length ? req.set("Cookie", cookies.join("; ")) : req;
  const api = {
    get: (url: string) => withCookies(request(app.getHttpServer()).get(url)),
    post: (url: string) => withCookies(request(app.getHttpServer()).post(url)),
    patch: (url: string) => withCookies(request(app.getHttpServer()).patch(url)),
    put: (url: string) => withCookies(request(app.getHttpServer()).put(url)),
  };
  const captureCookies = (res: request.Response): void => {
    const set = res.headers["set-cookie"];
    if (set) cookies = (Array.isArray(set) ? set : [set]).map((c) => c.split(";")[0]);
  };

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
    await app.init();

    // Чистый слепт данных для детерминизма (миграции применяет раннер отдельно)
    await pool.query(
      "truncate table events, messages, handoffs, conversations, visitors, chunks, faqs, documents, escalation_rules, assistants, sites, project_members, projects, settings, users restart identity cascade",
    );
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("миграции применены (схема существует)", async () => {
    const { rows } = await pool.query(
      "select count(*)::int as n from information_schema.tables where table_name = 'conversations'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("setup: первый владелец создаётся по токену", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/setup")
      .send({ token: SETUP_TOKEN, email: "owner@example.com", password: "password123", name: "Owner" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.installation_role).toBe("owner");
    captureCookies(res);
  });

  it("setup повторно → 409 SETUP_ALREADY_DONE", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/setup")
      .send({ token: SETUP_TOKEN, email: "x@example.com", password: "password123" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SETUP_ALREADY_DONE");
  });

  it("me: профиль по access-cookie", async () => {
    const res = await api.get("/api/v1/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("owner@example.com");
  });

  it("конверт ошибок: без авторизации → 401 UNAUTHORIZED в {error}", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("создание проекта и участники", async () => {
    const res = await api.post("/api/v1/projects").send({ name: "Проект A" });
    expect(res.status).toBe(201);
    projectId = res.body.data.project.id;
    expect(projectId).toBeTruthy();

    // Создаём оператора и добавляем в проект
    const user = await api.post("/api/v1/users").send({
      email: "operator@example.com",
      password: "password123",
      name: "Оператор",
    });
    expect(user.status).toBe(201);
    const operatorId = user.body.data.user.id;

    const members = await api
      .post(`/api/v1/projects/${projectId}/members`)
      .send({ user_id: operatorId, project_role: "operator" });
    expect(members.status).toBe(201);
    expect(members.body.data.members).toHaveLength(1);
  });

  it("изоляция: оператор не управляет проектом (403 FORBIDDEN_PROJECT, E8)", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "operator@example.com", password: "password123" });
    expect(login.status).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const operatorCookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.split(";")[0]);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set("Cookie", operatorCookies.join("; "))
      .send({ name: "Взлом" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_PROJECT");

    // но inbox-просмотр проекта оператору разрешён
    const view = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set("Cookie", operatorCookies.join("; "));
    expect(view.status).toBe(200);
  });

  it("ротация refresh: новая пара, старый refresh отозван", async () => {
    const first = await request(app.getHttpServer()).post("/api/v1/auth/refresh").set("Cookie", cookies.join("; "));
    expect(first.status).toBe(200);
    const oldCookies = cookies;
    captureCookies(first);

    const replay = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .set("Cookie", oldCookies.join("; "));
    expect(replay.status).toBe(401); // повторное использование отозванного refresh
  });

  it("brute-force: 6-я попытка логина → 429 LOGIN_LOCKED", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: "owner@example.com", password: "wrong-password" });
      expect(res.status).toBe(401);
    }
    const sixth = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "owner@example.com", password: "wrong-password" });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("LOGIN_LOCKED");
    expect(sixth.body.error.details.retry_after_s).toBeGreaterThan(0);
  });

  it("настройки: секрет шифруется в БД и маскируется в API", async () => {
    // отдаём throttling-окно: другой email
    const fresh = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "owner@example.com", password: "password123" });
    // владелец мог попасть под lockout после brute-force теста — refresh-ом восстанавливаем сессию
    const sess = fresh.status === 200 ? fresh : await request(app.getHttpServer()).post("/api/v1/auth/refresh").set("Cookie", cookies.join("; "));
    captureCookies(sess);

    const put = await api.put("/api/v1/settings/ai_provider.api_key").send({
      value: "sk-live-super-secret",
      is_secret: true,
    });
    expect(put.status).toBe(200);

    // В БД нет открытого текста (критерий приёмки Фазы 1)
    const { rows } = await pool.query("select value from settings where key = 'ai_provider.api_key'");
    expect(JSON.stringify(rows[0].value)).not.toContain("sk-live-super-secret");

    // API маскирует секрет
    const list = await api.get("/api/v1/settings");
    const stored = list.body.data.settings.find((s: { key: string }) => s.key === "ai_provider.api_key");
    expect(JSON.stringify(stored)).not.toContain("sk-live-super-secret");
    expect(stored.is_secret).toBe(true);
  });
});
