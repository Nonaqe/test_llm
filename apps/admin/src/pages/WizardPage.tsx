/**
 * /wizard — визард первого входа (docs/22 §1): setup-токен → администратор →
 * проект → сайт (+сниппет) → AI-провайдер → знания → готово.
 * Каждый шаг можно пропустить («позже»). POST /setup сам логини владельца
 * (httpOnly-cookie), поэтому шаги 1–2 объединены в одну форму setup.
 * Доступен без сессии (инсталляция ещё не настроена) и по явному заходу.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type { SiteDto } from "../api/types";
import { api, useAuth } from "../state/auth";
import { CopyButton, ErrorText, Field } from "../components/ui";

type StepKey = "setup" | "project" | "site" | "ai" | "knowledge" | "done";

const STEP_ORDER: readonly StepKey[] = ["setup", "project", "site", "ai", "knowledge", "done"];

const STEP_I18N: Record<StepKey, string> = {
  setup: "wizard.step.setup",
  project: "wizard.step.project",
  site: "wizard.step.site",
  ai: "wizard.step.ai",
  knowledge: "wizard.step.knowledge",
  done: "wizard.step.done",
};

export function WizardPage() {
  const { t } = useT();
  const auth = useAuth();

  // Без сессии начинаем с setup; после входа — с проекта.
  const [stepIndex, setStepIndex] = useState(() => (auth.user !== null ? 1 : 0));
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [createdSite, setCreatedSite] = useState<SiteDto | null>(null);

  // Вход после setup обновит auth.user — перепрыгиваем на следующий шаг.
  useEffect(() => {
    if (auth.user !== null && STEP_ORDER[stepIndex] === "setup") {
      setStepIndex(1);
    }
  }, [auth.user, stepIndex]);

  const step = STEP_ORDER[stepIndex] ?? "done";

  const goNext = (): void => {
    setStepIndex((prev) => Math.min(prev + 1, STEP_ORDER.length - 1));
  };
  const goBack = (): void => {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  return (
    <main className="wizard-wrap">
      <div className="page-card wizard-card">
        <h1>{t("wizard.title")}</h1>
        <p className="muted">{t("wizard.subtitle")}</p>

        <ol className="wizard-steps">
          {STEP_ORDER.map((key, index) => (
            <li
              key={key}
              className={`wizard-step${index === stepIndex ? " current" : ""}${index < stepIndex ? " passed" : ""}`}
            >
              {t(STEP_I18N[key])}
            </li>
          ))}
        </ol>

        <p className="muted small">
          {t("wizard.stepOf", {
            params: {
              current: stepIndex + 1,
              total: STEP_ORDER.length,
            },
          })}
        </p>

        {step === "setup" && (
          <SetupStep
            onDone={() => {
              // auth.user придёт из AuthProvider после успешного /setup;
              // на случай гонки двигаемся и вручную.
              goNext();
            }}
          />
        )}

        {step === "project" && (
          <ProjectStep
            onCreated={(id) => {
              setCreatedProjectId(id);
              goNext();
            }}
            onSkip={goNext}
          />
        )}

        {step === "site" && (
          <SiteStep
            projectId={createdProjectId}
            onCreated={(site) => {
              setCreatedSite(site);
              goNext();
            }}
            onSkip={goNext}
          />
        )}

        {step === "ai" && <AiStep onDone={goNext} onSkip={goNext} />}

        {step === "knowledge" && (
          <KnowledgeStep projectId={createdProjectId} onDone={goNext} onSkip={goNext} />
        )}

        {step === "done" && (
          <div>
            <h3>{t("wizard.done.title")}</h3>
            <p>{t("wizard.done.desc")}</p>
            {/* Многострочный чек-лист как текст */}
            <pre className="code-block">{t("wizard.done.checklist")}</pre>
            {createdSite !== null && (
              <>
                <p className="muted small">{t("sites.snippetTitle")}:</p>
                <CopyButton
                  text={`<script src="${window.location.origin}/widget.js" data-chat-key="${createdSite.widget_public_key}" defer></script>`}
                />
              </>
            )}
            <div className="actions wizard-actions">
              <Link className="btn primary" to="/inbox">
                {t("nav.inbox")}
              </Link>
              <Link className="btn" to={createdProjectId !== null ? `/projects/${createdProjectId}/sites` : "/projects"}>
                {t("wizard.done.toSites")}
              </Link>
              <Link className="btn" to={createdProjectId !== null ? `/projects/${createdProjectId}/sandbox` : "/inbox"}>
                {t("wizard.done.toSandbox")}
              </Link>
              <Link className="btn" to="/settings">
                {t("wizard.done.toSettings")}
              </Link>
            </div>
          </div>
        )}

        {step !== "setup" && step !== "done" && (
          <div className="actions wizard-nav">
            <button className="btn" type="button" onClick={goBack} disabled={stepIndex === 0}>
              {t("common.back")}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// --- Шаг 1–2: SETUP-токен + администратор (одна форма — контракт POST /setup) ---

function SetupStep({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const auth = useAuth();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // POST /setup создаёт владельца и ставит httpOnly-cookie (автовход).
      await api.setup({ token: token.trim(), email: email.trim(), password, name: name.trim() });
      await auth.refresh(); // фиксируем сессию в контексте
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "SETUP_ALREADY_DONE") {
        setAlreadyDone(true);
        return;
      }
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (alreadyDone) {
    return (
      <div>
        <p className="muted pad">{t("wizard.setup.alreadyDone")}</p>
        <Link className="btn primary" to="/login">
          {t("login.submit")}
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
      className="wizard-form"
    >
      <p className="muted small">{t("wizard.setup.desc")}</p>
      <Field label={t("wizard.setup.token")}>
        <input value={token} required onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </Field>
      <div className="form-grid">
        <Field label={t("common.email")}>
          <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("common.password")} hint={t("team.passwordHint")}>
          <input
            type="password"
            value={password}
            required
            minLength={8}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label={`${t("wizard.setup.name")} (${t("common.optional")})`}>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <ErrorText text={error} />
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? t("common.saving") : t("wizard.setup.submit")}
      </button>
    </form>
  );
}

// --- Шаг 3: проект ---

function ProjectStep({ onCreated, onSkip }: { onCreated: (id: string) => void; onSkip: () => void }) {
  const { t } = useT();
  const auth = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy || name.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createProject(name.trim());
      onCreated(res.project.id);
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
      className="wizard-form"
    >
      <p className="muted small">{t("wizard.project.desc")}</p>
      <Field label={t("common.name")}>
        <input value={name} required maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <ErrorText text={error} />
      <div className="actions">
        <button className="btn primary" type="submit" disabled={busy || name.trim() === ""}>
          {busy ? t("common.saving") : t("common.create")}
        </button>
        <button className="btn" type="button" onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
    </form>
  );
}

// --- Шаг 4: сайт (+сниппет показывается на шаге «готово») ---

function SiteStep({
  projectId,
  onCreated,
  onSkip,
}: {
  projectId: string | null;
  onCreated: (site: SiteDto) => void;
  onSkip: () => void;
}) {
  const { t } = useT();
  const auth = useAuth();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [originsText, setOriginsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (projectId === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createSite(projectId, {
        name: name.trim(),
        domain: domain.trim(),
        allowed_origins: originsText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== ""),
      });
      onCreated(res.site);
    } catch (err) {
      auth.onApiError(err);
      setError(
        err instanceof ApiError && err.status === 404 ? t("sites.notFound") : describeApiError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
      className="wizard-form"
    >
      <p className="muted small">{t("wizard.site.desc")}</p>
      {projectId === null && <p className="muted small">{t("wizard.project.desc")}</p>}
      <div className="form-grid">
        <Field label={t("common.name")}>
          <input value={name} required maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("sites.domain")}>
          <input
            value={domain}
            required
            maxLength={200}
            placeholder={t("sites.domainPlaceholder")}
            onChange={(e) => setDomain(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t("wizard.site.origins")}>
        <textarea rows={3} value={originsText} onChange={(e) => setOriginsText(e.target.value)} />
      </Field>
      <ErrorText text={error} />
      <div className="actions">
        <button
          className="btn primary"
          type="submit"
          disabled={busy || projectId === null || name.trim() === "" || domain.trim() === ""}
        >
          {busy ? t("common.saving") : t("common.create")}
        </button>
        <button className="btn" type="button" onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
    </form>
  );
}

// --- Шаг 5: AI-провайдер (ключи ai_provider.* — см. apps/api/src/ai) ---

function AiStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { t } = useT();
  const auth = useAuth();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const applyPreset = (key: string): void => {
    if (key === "openai") {
      setBaseUrl("https://api.openai.com/v1");
      setChatModel("gpt-4o-mini");
      setEmbeddingModel("text-embedding-3-small");
    } else if (key === "deepseek") {
      setBaseUrl("https://api.deepseek.com/v1");
      setChatModel("deepseek-chat");
    } else if (key === "ollama") {
      setBaseUrl("http://localhost:11434/v1");
      setChatModel("llama3.1");
      setEmbeddingModel("nomic-embed-text");
    }
  };

  const save = async (): Promise<void> => {
    // Пустые base_url/chat_model раньше писались в настройки как "" и
    // вскрывались только позже через «Проверить соединение» (аудит IR-059)
    if (baseUrl.trim() === "" || chatModel.trim() === "") {
      setError(t("set.ai.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.putSetting("ai_provider.kind", "openai_compatible");
      await api.putSetting("ai_provider.base_url", baseUrl.trim());
      await api.putSetting("ai_provider.chat_model", chatModel.trim());
      await api.putSetting("ai_provider.embedding_model", embeddingModel.trim());
      if (apiKey.trim() !== "") {
        await api.putSetting("ai_provider.api_key", apiKey.trim(), true);
      }
      onDone();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await api.checkAiProvider();
      setCheckResult(
        res.ok
          ? t("set.ai.checkOk", { params: { kind: res.kind ?? "?" } })
          : t("set.ai.checkFail", { params: { error: res.error ?? "" } }),
      );
    } catch (err) {
      auth.onApiError(err);
      setCheckResult(t("set.ai.checkFail", { params: { error: describeApiError(err) } }));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="wizard-form">
      <p className="muted small">{t("wizard.ai.desc")}</p>
      <div className="form-grid">
        <Field label={t("set.ai.preset")}>
          <select defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
            <option value="">—</option>
            <option value="openai">{t("set.ai.preset.openai")}</option>
            <option value="deepseek">{t("set.ai.preset.deepseek")}</option>
            <option value="ollama">{t("set.ai.preset.ollama")}</option>
          </select>
        </Field>
        <Field label={t("set.ai.baseUrl")}>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>
        <Field label={t("set.ai.apiKey")}>
          <input type="password" value={apiKey} autoComplete="off" onChange={(e) => setApiKey(e.target.value)} />
        </Field>
        <Field label={t("set.ai.chatModel")}>
          <input value={chatModel} onChange={(e) => setChatModel(e.target.value)} />
        </Field>
        <Field label={t("set.ai.embeddingModel")}>
          <input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} />
        </Field>
      </div>
      <ErrorText text={error} />
      {checkResult !== null && <p className="muted small">{checkResult}</p>}
      <div className="actions">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
        <button className="btn" type="button" disabled={checking} onClick={() => void check()}>
          {checking ? t("set.ai.checking") : t("set.ai.check")}
        </button>
        <button className="btn" type="button" onClick={onSkip}>
          {t("common.skip")}
        </button>
      </div>
    </div>
  );
}

// --- Шаг 6: знания (минимум — одна форма: файл или текст) ---

function KnowledgeStep({
  projectId,
  onDone,
  onSkip,
}: {
  projectId: string | null;
  onDone: () => void;
  onSkip: () => void;
}) {
  const { t } = useT();
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uploadFile = async (file: File): Promise<void> => {
    if (projectId === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument(projectId, file);
      onDone();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const addText = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (projectId === null || busy || title.trim() === "" || text.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await api.addKnowledgeText(projectId, title.trim(), text.trim());
      onDone();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wizard-form">
      <p className="muted small">{t("wizard.knowledge.desc")}</p>
      {projectId === null && <p className="muted small">{t("wizard.project.desc")}</p>}

      <div className="actions">
        <button
          className="btn"
          type="button"
          disabled={busy || projectId === null}
          onClick={() => fileRef.current?.click()}
        >
          {t("wizard.knowledge.file")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.csv,.md"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void uploadFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <form
        onSubmit={(e) => {
          void addText(e);
        }}
      >
        <Field label={t("kb.textTitle")}>
          <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("kb.textContent")}>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <ErrorText text={error} />
        <div className="actions">
          <button
            className="btn primary"
            type="submit"
            disabled={busy || projectId === null || title.trim() === "" || text.trim() === ""}
          >
            {busy ? t("kb.uploading") : t("common.add")}
          </button>
          <button className="btn" type="button" onClick={onSkip}>
            {t("common.skip")}
          </button>
        </div>
      </form>
    </div>
  );
}
