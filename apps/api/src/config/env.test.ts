import { describe, expect, it } from "vitest";
import { envIssues, loadEnv } from "./env";

describe("config/env (docs/17_CONFIGURATION.md)", () => {
  it("дефолты применяются при пустом окружении", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("PORT приводится к числу", () => {
    expect(loadEnv({ PORT: "8080" }).PORT).toBe(8080);
  });

  it("некорректный PORT — машинально читаемая ошибка", () => {
    const issues = envIssues({ PORT: "-1" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.path).toBe("PORT");
  });

  it("некорректный LOG_LEVEL отклоняется", () => {
    expect(envIssues({ LOG_LEVEL: "verbose" }).length).toBeGreaterThan(0);
  });

  it("APP_SECRET короче 16 символов отклоняется", () => {
    expect(envIssues({ APP_SECRET: "short" }).length).toBeGreaterThan(0);
  });

  it("валидное окружение парсится целиком", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      PORT: "3000",
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      APP_SECRET: "0123456789abcdef",
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.DATABASE_URL).toBe("postgres://u:p@localhost:5432/db");
  });
});
