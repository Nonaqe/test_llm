/**
 * /settings — настройки установки (docs/22 §7): AI-провайдер (пресеты,
 * маскированный ключ, «Проверить соединение»), SMTP (ключи smtp.*),
 * карточки-заглушки Бэкапы/Телеметрия/Обновления («в разработке», без фейковых
 * действий). Контракты: GET /settings, PUT /settings/:key {value,is_secret},
 * POST /settings/ai-provider/check.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type { AiProviderCheckResult, PublicSetting } from "../api/types";
import { api, useAuth } from "../state/auth";
import { ErrorText, Field } from "../components/ui";

type PresetKey = "openai" | "deepseek" | "openrouter" | "ollama" | "custom";

const PRESETS: Record<PresetKey, { baseUrl: string; chatModel: string; embeddingModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", chatModel: "gpt-4o-mini", embeddingModel: "text-embedding-3-small" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", chatModel: "deepseek-chat", embeddingModel: "" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", chatModel: "openai/gpt-4o-mini", embeddingModel: "" },
  ollama: { baseUrl: "http://localhost:11434/v1", chatModel: "llama3.1", embeddingModel: "nomic-embed-text" },
  custom: { baseUrl: "", chatModel: "", embeddingModel: "" },
};

/** Ключи ai_provider.* читает apps/api/src/ai/ai-provider.service.ts. */
const AI_KEYS = {
  kind: "ai_provider.kind",
  baseUrl: "ai_provider.base_url",
  chatModel: "ai_provider.chat_model",
  embeddingModel: "ai_provider.embedding_model",
  apiKey: "ai_provider.api_key",
} as const;

/** Ключи SMTP установки (settings keys smtp.*). */
const SMTP_KEYS = {
  host: "smtp.host",
  port: "smtp.port",
  user: "smtp.user",
  pass: "smtp.pass",
  from: "smtp.from",
} as const;

function settingString(settings: PublicSetting[], key: string): string {
  const found = settings.find((s) => s.key === key);
  const value = found?.value;
  return typeof value === "string" ? value : "";
}

function settingIsSecretSaved(settings: PublicSetting[], key: string): boolean {
  const found = settings.find((s) => s.key === key && s.is_secret);
  // Секреты маскируются ({masked:true}) — сам значение не возвращается (docs/15 §3).
  return found !== undefined && found.value !== null && typeof found.value === "object";
}

export function SettingsPage() {
  const { t } = useT();
  const auth = useAuth();

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [preset, setPreset] = useState<PresetKey>("custom");
  const [baseUrl, setBaseUrl] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpPassSaved, setSmtpPassSaved] = useState(false);

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<AiProviderCheckResult | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await api.listSettings();
      const settings = res.settings ?? [];
      setBaseUrl(settingString(settings, AI_KEYS.baseUrl));
      setChatModel(settingString(settings, AI_KEYS.chatModel));
      setEmbeddingModel(settingString(settings, AI_KEYS.embeddingModel));
      setApiKeySaved(settingIsSecretSaved(settings, AI_KEYS.apiKey));
      setSmtpHost(settingString(settings, SMTP_KEYS.host));
      setSmtpPort(settingString(settings, SMTP_KEYS.port));
      setSmtpUser(settingString(settings, SMTP_KEYS.user));
      setSmtpPassSaved(settingIsSecretSaved(settings, SMTP_KEYS.pass));
      setSmtpFrom(settingString(settings, SMTP_KEYS.from));
    } catch (err) {
      auth.onApiError(err);
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  const flashSaved = (): void => {
    setSavedNote(t("common.saved"));
    window.setTimeout(() => setSavedNote(null), 2500);
  };

  const putAll = async (entries: Array<{ key: string; value: unknown; isSecret?: boolean }>): Promise<void> => {
    for (const entry of entries) {
      await api.putSetting(entry.key, entry.value, entry.isSecret ?? false);
    }
  };

  const applyPreset = (next: PresetKey): void => {
    setPreset(next);
    const p = PRESETS[next];
    if (p.baseUrl !== "") setBaseUrl(p.baseUrl);
    if (p.chatModel !== "") setChatModel(p.chatModel);
    if (p.embeddingModel !== "") setEmbeddingModel(p.embeddingModel);
  };

  const saveAi = async (): Promise<void> => {
    setError(null);
    try {
      const entries: Array<{ key: string; value: unknown; isSecret?: boolean }> = [
        { key: AI_KEYS.kind, value: "openai_compatible" },
        { key: AI_KEYS.baseUrl, value: baseUrl.trim() },
        { key: AI_KEYS.chatModel, value: chatModel.trim() },
        { key: AI_KEYS.embeddingModel, value: embeddingModel.trim() },
      ];
      // Пустой ключ = не менять (секрет маскируется и обратно не читается).
      if (apiKey.trim() !== "") {
        entries.push({ key: AI_KEYS.apiKey, value: apiKey.trim(), isSecret: true });
      }
      await putAll(entries);
      setApiKey("");
      setApiKeySaved(true);
      flashSaved();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    }
  };

  const checkAi = async (): Promise<void> => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await api.checkAiProvider();
      setCheckResult(res);
    } catch (err) {
      auth.onApiError(err);
      setCheckResult({ ok: false, error: describeApiError(err) });
    } finally {
      setChecking(false);
    }
  };

  const saveSmtp = async (): Promise<void> => {
    setError(null);
    try {
      const entries: Array<{ key: string; value: unknown; isSecret?: boolean }> = [
        { key: SMTP_KEYS.host, value: smtpHost.trim() },
        { key: SMTP_KEYS.port, value: smtpPort.trim() === "" ? null : Number(smtpPort.trim()) },
        { key: SMTP_KEYS.user, value: smtpUser.trim() },
        { key: SMTP_KEYS.from, value: smtpFrom.trim() },
      ];
      if (smtpPass.trim() !== "") {
        entries.push({ key: SMTP_KEYS.pass, value: smtpPass.trim(), isSecret: true });
      }
      await putAll(entries);
      setSmtpPass("");
      setSmtpPassSaved(true);
      flashSaved();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    }
  };

  if (forbidden) {
    return (
      <div className="page-card">
        <h2>{t("set.title")}</h2>
        <p className="muted pad">{t("set.forbidden")}</p>
      </div>
    );
  }

  return (
    <div className="page-card">
      <div className="page-head">
        <h2>{t("set.title")}</h2>
        {savedNote !== null && <span className="ok-text">{savedNote}</span>}
      </div>

      <ErrorText text={error} />
      {loading && <p className="muted pad">{t("common.loading")}</p>}

      {!loading && (
        <>
          {/* --- AI-провайдер --- */}
          <section className="team-section">
            <h3>{t("set.ai.title")}</h3>
            <div className="form-grid">
              <Field label={t("set.ai.preset")}>
                <select value={preset} onChange={(e) => applyPreset(e.target.value as PresetKey)}>
                  {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                    <option key={key} value={key}>
                      {t(`set.ai.preset.${key}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("set.ai.baseUrl")}>
                <input
                  value={baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </Field>
              <Field label={t("set.ai.apiKey")} hint={apiKeySaved ? t("set.ai.apiKeyMasked") : undefined}>
                <input
                  type="password"
                  value={apiKey}
                  autoComplete="off"
                  placeholder={apiKeySaved ? "••••••••" : ""}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>
              <Field label={t("set.ai.chatModel")}>
                <input value={chatModel} onChange={(e) => setChatModel(e.target.value)} />
              </Field>
              <Field label={t("set.ai.embeddingModel")} hint={t("set.ai.embeddingWarning")}>
                <input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} />
              </Field>
            </div>
            <div className="actions">
              <button className="btn primary" type="button" onClick={() => void saveAi()}>
                {t("common.save")}
              </button>
              <button className="btn" type="button" disabled={checking} onClick={() => void checkAi()}>
                {checking ? t("set.ai.checking") : t("set.ai.check")}
              </button>
            </div>
            {checkResult !== null && (
              <p className={checkResult.ok ? "ok-text" : "error-text"}>
                {checkResult.ok
                  ? t("set.ai.checkOk", { params: { kind: checkResult.kind ?? "?" } })
                  : t("set.ai.checkFail", { params: { error: checkResult.error ?? "" } })}
              </p>
            )}
          </section>

          {/* --- SMTP --- */}
          <section className="team-section">
            <h3>{t("set.smtp.title")}</h3>
            <p className="muted small">{t("set.smtp.hint")}</p>
            <div className="form-grid">
              <Field label={t("set.smtp.host")}>
                <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
              </Field>
              <Field label={t("set.smtp.port")}>
                <input type="number" min={0} max={65535} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
              </Field>
              <Field label={t("set.smtp.user")}>
                <input value={smtpUser} autoComplete="off" onChange={(e) => setSmtpUser(e.target.value)} />
              </Field>
              <Field label={t("set.smtp.pass")} hint={smtpPassSaved ? t("set.secretSaved") : undefined}>
                <input
                  type="password"
                  value={smtpPass}
                  autoComplete="new-password"
                  placeholder={smtpPassSaved ? "••••••••" : ""}
                  onChange={(e) => setSmtpPass(e.target.value)}
                />
              </Field>
              <Field label={t("set.smtp.from")}>
                <input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
              </Field>
            </div>
            <button className="btn primary" type="button" onClick={() => void saveSmtp()}>
              {t("common.save")}
            </button>
          </section>

          {/* --- Честные заглушки (без фейковых действий) --- */}
          <section className="stub-grid">
            <StubCard title={t("set.stubs.backups")} desc={t("set.stubs.backupsDesc")} />
            <StubCard title={t("set.stubs.telemetry")} desc={t("set.stubs.telemetryDesc")} />
            <StubCard title={t("set.stubs.updates")} desc={t("set.stubs.updatesDesc")} />
          </section>
        </>
      )}
    </div>
  );
}

function StubCard({ title, desc }: { title: string; desc: string }) {
  const { t } = useT();
  return (
    <article className="stub-card">
      <header className="site-head">
        <strong>{title}</strong>
        <span className="chip">{t("set.wip")}</span>
      </header>
      <p className="muted small">{desc}</p>
    </article>
  );
}
