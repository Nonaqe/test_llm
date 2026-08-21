import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock поднимается выше импортов: модуль nodemailer заменяется целиком
const createTransport = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ createTransport }));

import type { SettingsRepo } from "../db/repositories";
import { SettingsService } from "../settings/settings.service";
import { SmtpMailer } from "./smtp-mailer";

function fakeSettingsRepo(values: Record<string, unknown>): SettingsRepo {
  return {
    get: async (key: string) =>
      key in values ? { value: values[key], is_secret: false } : null,
  } as unknown as SettingsRepo;
}

function fakeSettingsService(secret: string | null): SettingsService {
  return { getSecret: async () => secret } as unknown as SettingsService;
}

function fakeTransport() {
  return { sendMail: vi.fn(async () => ({})), close: vi.fn() };
}

describe("SmtpMailer (docs/30 §Ф7)", () => {
  let transport: ReturnType<typeof fakeTransport>;

  beforeEach(() => {
    createTransport.mockReset();
    transport = fakeTransport();
    createTransport.mockReturnValue(transport);
  });

  it("пустой smtp.host → фолбэк к логу без исключений и без транспорта", async () => {
    const mailer = new SmtpMailer(fakeSettingsRepo({ "smtp.host": "" }), fakeSettingsService(null));
    await expect(mailer.send(["op@example.com"], "Тема", "Тело")).resolves.toBeUndefined();
    expect(createTransport).not.toHaveBeenCalled();
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it("настроенный SMTP → createTransport с host/port/secure/auth и sendMail с письмом", async () => {
    const repo = fakeSettingsRepo({
      "smtp.host": "smtp.example.com",
      "smtp.port": "465",
      "smtp.user": "bot@example.com",
      "smtp.from": "chat@example.com",
    });
    const mailer = new SmtpMailer(repo, fakeSettingsService("s3cret"));

    await mailer.send(["op@example.com"], "Диалог ждёт", "Тело письма");

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true, // port === 465
      auth: { user: "bot@example.com", pass: "s3cret" },
    });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: "chat@example.com",
      to: ["op@example.com"],
      subject: "Диалог ждёт",
      text: "Тело письма",
    });
    expect(transport.close).toHaveBeenCalled();
  });

  it("порт не 465 → secure:false; нет user → транспорт без auth", async () => {
    const repo = fakeSettingsRepo({ "smtp.host": "mx.local", "smtp.port": "25" });
    const mailer = new SmtpMailer(repo, fakeSettingsService(null));

    await mailer.send(["op@example.com"], "s", "b");

    expect(createTransport).toHaveBeenCalledWith({
      host: "mx.local",
      port: 25,
      secure: false,
    });
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "" }),
    );
  });

  it("нет smtp.from → from = smtp.user", async () => {
    const repo = fakeSettingsRepo({
      "smtp.host": "mx.local",
      "smtp.port": "587",
      "smtp.user": "bot@example.com",
    });
    const mailer = new SmtpMailer(repo, fakeSettingsService("pw"));

    await mailer.send(["op@example.com"], "s", "b");

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, auth: { user: "bot@example.com", pass: "pw" } }),
    );
    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: "bot@example.com" }));
  });

  it("настройки читаются при каждой отправке (без кэша конфига)", async () => {
    const values: Record<string, unknown> = { "smtp.host": "first.local" };
    const get = vi.fn(async (key: string) =>
      key in values ? { value: values[key], is_secret: false } : null,
    );
    const mailer = new SmtpMailer({ get } as unknown as SettingsRepo, fakeSettingsService(null));

    await mailer.send(["a@x"], "s", "b");
    values["smtp.host"] = "second.local";
    await mailer.send(["a@x"], "s", "b");

    expect(get).toHaveBeenCalledTimes(8); // 2 отправки × 4 ключа (host, port, user, from)
    expect(createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: "second.local" }),
    );
  });

  it("пустой список получателей — ранний выход без чтения настроек", async () => {
    const get = vi.fn();
    const mailer = new SmtpMailer({ get } as unknown as SettingsRepo, fakeSettingsService(null));
    await mailer.send([], "s", "b");
    expect(get).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });
});
