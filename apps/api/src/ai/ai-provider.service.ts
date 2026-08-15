/**
 * Фабрика провайдеров (docs/11 §2): конфиг в settings (ai_provider.*),
 * kind = fake | openai_compatible. Кэш разрешения 30 с.
 */
import { Injectable } from "@nestjs/common";
import {
  FakeEmbeddingProvider,
  FakeLlmProvider,
  type EmbeddingProvider,
  type LlmProvider,
} from "@uni-chat/core";
import { SettingsRepo } from "../db/repositories";
import { SettingsService } from "../settings/settings.service";
import {
  OpenAiCompatibleEmbeddingProvider,
  OpenAiCompatibleLlmProvider,
} from "./openai-compatible.provider";

export interface AiProviderConfig {
  kind: "fake" | "openai_compatible";
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
}

const CACHE_TTL_MS = 30_000;

@Injectable()
export class AiProviderService {
  private cached: { config: AiProviderConfig; apiKey: string; at: number } | null = null;

  constructor(
    private readonly settingsRepo: SettingsRepo,
    private readonly settings: SettingsService,
  ) {}

  async resolve(force = false): Promise<{ config: AiProviderConfig; apiKey: string }> {
    if (!force && this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return { config: this.cached.config, apiKey: this.cached.apiKey };
    }
    const read = async (key: string): Promise<unknown> =>
      (await this.settingsRepo.get(key))?.value ?? null;
    const kindRaw = await read("ai_provider.kind");
    const kind = kindRaw === "openai_compatible" ? "openai_compatible" : "fake";
    const config: AiProviderConfig = {
      kind,
      baseUrl: String((await read("ai_provider.base_url")) ?? "").replace(/\/+$/, ""),
      chatModel: String((await read("ai_provider.chat_model")) ?? ""),
      embeddingModel: String((await read("ai_provider.embedding_model")) ?? ""),
    };
    const apiKey = kind === "openai_compatible" ? ((await this.settings.getSecret("ai_provider.api_key")) ?? "") : "";
    this.cached = { config, apiKey, at: Date.now() };
    return { config, apiKey };
  }

  async llm(): Promise<LlmProvider> {
    const { config, apiKey } = await this.resolve();
    if (config.kind === "fake") return new FakeLlmProvider();
    if (!config.baseUrl || !config.chatModel) {
      throw new Error("AI-провайдер не настроен: задайте ai_provider.base_url и chat_model (docs/17 §3)");
    }
    return new OpenAiCompatibleLlmProvider(config.baseUrl, apiKey, config.chatModel);
  }

  async embedding(): Promise<EmbeddingProvider> {
    const { config, apiKey } = await this.resolve();
    if (config.kind === "fake") return new FakeEmbeddingProvider();
    if (!config.baseUrl || !config.embeddingModel) {
      throw new Error("AI-провайдер не настроен: задайте ai_provider.base_url и embedding_model (docs/17 §3)");
    }
    return new OpenAiCompatibleEmbeddingProvider(
      config.baseUrl,
      apiKey,
      config.embeddingModel,
      1536,
    );
  }

  /** «Проверить соединение» (docs/22 §3): тестовый вызов эмбеддингов. */
  async check(): Promise<{ ok: true; kind: string } | { ok: false; error: string }> {
    try {
      const provider = await this.embedding();
      const vectors = await provider.embed(["ping"]);
      if (vectors.length !== 1 || vectors[0]!.length === 0) {
        throw new Error("пустой ответ эмбеддингов");
      }
      const { config } = await this.resolve();
      return { ok: true, kind: config.kind };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export { FakeEmbeddingProvider, FakeLlmProvider };
