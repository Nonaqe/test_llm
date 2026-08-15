import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../config/env";
import { SettingsRepo } from "../db/repositories";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret-box";

export interface PublicSetting {
  key: string;
  is_secret: boolean;
  /** Для секретов значение не возвращается (маскируется — docs/15 §3) */
  value: unknown;
}

/** Настройки установки: секреты шифруются AES-256-GCM перед записью (docs/17 §4). */
@Injectable()
export class SettingsService {
  constructor(
    private readonly repo: SettingsRepo,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async set(key: string, value: unknown, isSecret: boolean): Promise<void> {
    if (!this.env.APP_SECRET) {
      // Секреты без APP_SECRET не сохраняем — молчаливое plaintext недопустимо (docs/17 §4)
      if (isSecret) throw new Error("APP_SECRET не задан: секретные настройки недоступны");
    }
    const stored = isSecret && typeof value === "string" && value.length > 0 && this.env.APP_SECRET
      ? { enc: encryptSecret(value, this.env.APP_SECRET) }
      : value;
    await this.repo.set(key, stored, isSecret);
  }

  async list(): Promise<PublicSetting[]> {
    const rows = await this.repo.list();
    return rows.map((row) => ({
      key: row.key,
      is_secret: row.is_secret,
      value: row.is_secret ? this.maskedSecret(row.value) : row.value,
    }));
  }

  /** Расшифровка для внутреннего использования (провайдер AI и т.п.). */
  async getSecret(key: string): Promise<string | null> {
    const row = await this.repo.get(key);
    if (!row || !row.is_secret) return null;
    const value = row.value as { enc?: string } | string;
    const packed = typeof value === "string" ? value : value.enc;
    if (!packed || !this.env.APP_SECRET) return null;
    return isEncryptedSecret(packed) ? decryptSecret(packed, this.env.APP_SECRET) : null;
  }

  private maskedSecret(value: unknown): unknown {
    const v = value as { enc?: string } | string | null;
    const packed = typeof v === "string" ? v : v?.enc;
    return packed ? { masked: true } : null;
  }
}
