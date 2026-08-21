/**
 * /projects/:id/assistant — настройки ассистента (docs/22 §4) и редактор правил
 * эскалации (docs/14 §3–4): простой режим (чекбоксы) и продвинутый (таблица CRUD).
 * Контракты: GET/PATCH /projects/:id/assistant, CRUD /projects/:id/assistant/rules.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type {
  AssistantDto,
  EscalationActionValue,
  EscalationRuleDto,
  EscalationRuleTypeValue,
} from "../api/types";
import { api, useAuth } from "../state/auth";
import { useProjectRouteId } from "../components/Layout";
import { ConfirmDialog, ErrorText, Field } from "../components/ui";

const RULE_TYPES: readonly EscalationRuleTypeValue[] = [
  "explicit_request",
  "low_confidence",
  "keyword",
  "intent",
  "complaint",
  "no_answer",
];

const RULE_ACTIONS: readonly EscalationActionValue[] = ["handoff", "fallback_message"];

/** Приоритеты по умолчанию для простого режима (порядок проверки — docs/14 §3). */
const SIMPLE_PRIORITY: Record<EscalationRuleTypeValue, number> = {
  explicit_request: 10,
  low_confidence: 20,
  keyword: 30,
  intent: 40,
  complaint: 50,
  no_answer: 60,
};

/** Параметры по умолчанию для типов, где они обязательны (контроллер валидирует). */
function defaultParams(type: EscalationRuleTypeValue): Record<string, unknown> {
  switch (type) {
    case "low_confidence":
      return { threshold: 0.55 };
    case "keyword":
      return { patterns: ["оператор"] };
    case "intent":
      return { intent: "handoff" };
    case "no_answer":
      return { max_fallbacks: 2 };
    default:
      return {};
  }
}

export function AssistantPage() {
  const { t } = useT();
  const auth = useAuth();
  const projectId = useProjectRouteId();

  const [assistant, setAssistant] = useState<AssistantDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Черновик формы ассистента.
  const [name, setName] = useState("");
  const [locale, setLocale] = useState("ru");
  const [tone, setTone] = useState("professional");
  const [companyDescription, setCompanyDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [fallbackMessage, setFallbackMessage] = useState("");
  const [deniedTopicsText, setDeniedTopicsText] = useState("");
  const [topK, setTopK] = useState(6);
  const [scoreThreshold, setScoreThreshold] = useState(0.55);
  const [historyDepth, setHistoryDepth] = useState(10);

  const fillFrom = useCallback((a: AssistantDto): void => {
    setName(a.name);
    setLocale(a.locale);
    setTone(a.tone);
    setCompanyDescription(a.company_description);
    setInstructions(a.custom_instructions);
    setFallbackMessage(a.safety_settings?.fallback_message ?? "");
    setDeniedTopicsText((a.safety_settings?.denied_topics ?? []).join(", "));
    setTopK(a.retrieval_settings?.top_k ?? 6);
    setScoreThreshold(a.retrieval_settings?.score_threshold ?? 0.55);
    setHistoryDepth(a.retrieval_settings?.history_depth ?? 10);
  }, []);

  const load = useCallback(async () => {
    if (projectId === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAssistant(projectId);
      setAssistant(res.assistant);
      fillFrom(res.assistant);
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, auth, fillFrom]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (projectId === null) return;
    setError(null);
    setSaved(false);
    try {
      const res = await api.updateAssistant(projectId, {
        name: name.trim() !== "" ? name.trim() : undefined,
        locale,
        tone,
        company_description: companyDescription,
        custom_instructions: instructions,
        safety_settings: {
          fallback_message: fallbackMessage,
          denied_topics: deniedTopicsText
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== ""),
        },
        retrieval_settings: {
          top_k: topK,
          score_threshold: scoreThreshold,
          history_depth: historyDepth,
        },
      });
      setAssistant(res.assistant);
      fillFrom(res.assistant);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    }
  };

  if (projectId === null)
    return <div className="page-card"><p className="muted pad">{t("project.none")}</p></div>;

  return (
    <div className="page-card">
      <div className="page-head">
        <h2>{t("assistant.title")}</h2>
        <span className="spacer" />
        {saved && <span className="ok-text">{t("assistant.saved")}</span>}
        <button className="btn primary" type="button" disabled={loading} onClick={() => void save()}>
          {t("common.save")}
        </button>
      </div>

      <ErrorText text={error} />
      {loading && assistant === null && <p className="muted pad">{t("common.loading")}</p>}

      {assistant !== null && (
        <>
          <div className="form-grid">
            <Field label={t("assistant.name")}>
              <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("assistant.locale")}>
              <select value={locale} onChange={(e) => setLocale(e.target.value)}>
                <option value="ru">ru</option>
                <option value="en">en</option>
              </select>
            </Field>
            <Field label={t("assistant.tone")}>
              <input value={tone} maxLength={50} onChange={(e) => setTone(e.target.value)} placeholder="professional" />
            </Field>
          </div>

          <Field label={t("assistant.companyDescription")}>
            <textarea rows={3} value={companyDescription} maxLength={5000} onChange={(e) => setCompanyDescription(e.target.value)} />
          </Field>
          <Field label={t("assistant.instructions")}>
            <textarea rows={5} value={instructions} maxLength={5000} onChange={(e) => setInstructions(e.target.value)} />
          </Field>
          <Field label={t("assistant.fallbackMessage")}>
            <textarea rows={2} value={fallbackMessage} maxLength={1000} onChange={(e) => setFallbackMessage(e.target.value)} />
          </Field>
          <Field label={t("assistant.deniedTopics")}>
            <input value={deniedTopicsText} onChange={(e) => setDeniedTopicsText(e.target.value)} />
          </Field>

          <fieldset className="widget-builder">
            <legend>retrieval_settings</legend>
            <div className="form-grid">
              <Field label={t("assistant.topK")}>
                <input type="number" min={1} max={20} value={topK} onChange={(e) => setTopK(Number(e.target.value))} />
              </Field>
              <Field label={t("assistant.scoreThreshold")}>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={scoreThreshold}
                  onChange={(e) => setScoreThreshold(Number(e.target.value))}
                />
              </Field>
              <Field label={t("assistant.historyDepth")}>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={historyDepth}
                  onChange={(e) => setHistoryDepth(Number(e.target.value))}
                />
              </Field>
            </div>
          </fieldset>

          <RulesEditor projectId={projectId} />
        </>
      )}
    </div>
  );
}

// --- Правила эскалации ---

function RulesEditor({ projectId }: { projectId: string }) {
  const { t } = useT();
  const auth = useAuth();
  const [rules, setRules] = useState<EscalationRuleDto[]>([]);
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Простой режим: порог уверенности и число подряд fallback-ов.
  const [threshold, setThreshold] = useState(0.55);
  const [maxFallbacks, setMaxFallbacks] = useState(2);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.listRules(projectId);
      setRules(res.rules);
      setLoaded(true);
      const low = res.rules.find((r) => r.type === "low_confidence");
      const lowThresh = low?.params["threshold"];
      if (typeof lowThresh === "number") setThreshold(lowThresh);
      const na = res.rules.find((r) => r.type === "no_answer");
      const naMax = na?.params["max_fallbacks"];
      if (typeof naMax === "number") setMaxFallbacks(naMax);
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    }
  }, [projectId, auth]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Первое правило данного типа (для простого режима). */
  const ruleOfType = (type: EscalationRuleTypeValue): EscalationRuleDto | undefined =>
    rules.find((r) => r.type === type);

  const upsertSimple = async (
    type: EscalationRuleTypeValue,
    enable: boolean,
    params?: Record<string, unknown>,
  ): Promise<void> => {
    setError(null);
    try {
      const existing = ruleOfType(type);
      if (existing === undefined) {
        if (!enable) return;
        const res = await api.createRule(projectId, {
          priority: SIMPLE_PRIORITY[type],
          type,
          params: params ?? defaultParams(type),
          action: "handoff",
          enabled: true,
        });
        setRules((prev) => [...prev, res.rule]);
        return;
      }
      const patch: { enabled?: boolean; params?: Record<string, unknown> } = {};
      if (existing.enabled !== enable) patch.enabled = enable;
      if (enable && params !== undefined) patch.params = params;
      if (Object.keys(patch).length === 0) return;
      const res = await api.updateRule(projectId, existing.id, patch);
      setRules((prev) => prev.map((r) => (r.id === existing.id ? res.rule : r)));
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    }
  };

  const simpleRow = (
    type: EscalationRuleTypeValue,
    label: string,
    extra?: ReactNode,
  ): JSX.Element => {
    const rule = ruleOfType(type);
    const checked = rule !== undefined && rule.enabled;
    return (
      <div key={type} className="rule-simple-row">
        <label className="note-toggle">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => void upsertSimple(type, e.target.checked)}
          />
          <span>{label}</span>
        </label>
        {checked && extra}
      </div>
    );
  };

  return (
    <section className="rules-section">
      <div className="page-head">
        <h3>{t("rules.title")}</h3>
        <span className="spacer" />
        <button className={`btn${mode === "simple" ? " primary" : ""}`} type="button" onClick={() => setMode("simple")}>
          {t("rules.simple")}
        </button>
        <button className={`btn${mode === "advanced" ? " primary" : ""}`} type="button" onClick={() => setMode("advanced")}>
          {t("rules.advanced")}
        </button>
      </div>

      <ErrorText text={error} />

      {mode === "simple" && (
        <div className="rules-simple">
          {simpleRow("explicit_request", t("rules.explicit"))}
          {simpleRow(
            "low_confidence",
            t("rules.lowConfidence"),
            <span className="rule-extra">
              <label className="mini-field">
                <span>{t("rules.threshold")}</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  onBlur={() => void upsertSimple("low_confidence", true, { threshold })}
                />
              </label>
            </span>,
          )}
          {simpleRow("complaint", t("rules.complaint"))}
          {simpleRow(
            "no_answer",
            `${t("rules.noAnswer")} (${t("rules.inRow")})`,
            <span className="rule-extra">
              <label className="mini-field">
                <span>N</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxFallbacks}
                  onChange={(e) => setMaxFallbacks(Number(e.target.value))}
                  onBlur={() => void upsertSimple("no_answer", true, { max_fallbacks: maxFallbacks })}
                />
              </label>
            </span>,
          )}
        </div>
      )}

      {mode === "advanced" && loaded && (
        <AdvancedRules
          projectId={projectId}
          rules={rules}
          onRulesChange={setRules}
          onError={setError}
          onDeleteAsk={setDeletingId}
        />
      )}

      {deletingId !== null && (
        <ConfirmDialog
          title={t("common.delete")}
          body={t("rules.deleteConfirm")}
          onCancel={() => setDeletingId(null)}
          onConfirm={() => {
            const id = deletingId;
            setDeletingId(null);
            if (id === null) return;
            void api
              .deleteRule(projectId, id)
              .then(() => setRules((prev) => prev.filter((r) => r.id !== id)))
              .catch((err: unknown) => {
                auth.onApiError(err);
                setError(describeApiError(err));
              });
          }}
        />
      )}
    </section>
  );
}

/** Продвинутый режим: таблица правил с полным CRUD. */
function AdvancedRules({
  projectId,
  rules,
  onRulesChange,
  onError,
  onDeleteAsk,
}: {
  projectId: string;
  rules: EscalationRuleDto[];
  onRulesChange: (rules: EscalationRuleDto[]) => void;
  onError: (message: string | null) => void;
  onDeleteAsk: (id: string) => void;
}) {
  const { t } = useT();
  const auth = useAuth();
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  const patchRule = async (rule: EscalationRuleDto, patch: Partial<EscalationRuleDto>): Promise<void> => {
    onError(null);
    try {
      const res = await api.updateRule(projectId, rule.id, {
        priority: patch.priority,
        type: patch.type,
        params: patch.params,
        action: patch.action,
        enabled: patch.enabled,
      });
      onRulesChange(rules.map((r) => (r.id === rule.id ? res.rule : r)));
    } catch (err) {
      if (err instanceof ApiError && err.code === "RULE_PRIORITY_TAKEN") {
        onError(t("rules.priorityTaken"));
        return;
      }
      auth.onApiError(err);
      onError(describeApiError(err));
    }
  };

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t("rules.table.priority")}</th>
            <th>{t("rules.table.type")}</th>
            <th>{t("rules.table.params")}</th>
            <th>{t("rules.table.action")}</th>
            <th>{t("rules.table.enabled")}</th>
            <th>{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((rule) => (
            <tr key={rule.id}>
              <td>
                <input
                  className="cell-num"
                  type="number"
                  min={1}
                  max={1000}
                  defaultValue={rule.priority}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value !== rule.priority) void patchRule(rule, { priority: value });
                  }}
                />
              </td>
              <td>{t(`rules.type.${rule.type}`, { fallback: rule.type })}</td>
              <td>
                <code className="small">{JSON.stringify(rule.params)}</code>
              </td>
              <td>
                <select
                  value={rule.action}
                  onChange={(e) =>
                    void patchRule(rule, { action: e.target.value as EscalationActionValue })
                  }
                >
                  {RULE_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(`rules.action.${a}`)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => void patchRule(rule, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <button className="btn danger small-btn" type="button" onClick={() => onDeleteAsk(rule.id)}>
                  {t("common.delete")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddRuleForm
        projectId={projectId}
        onCreated={(rule) => onRulesChange([...rules, rule])}
        onError={onError}
      />
    </div>
  );
}

function AddRuleForm({
  projectId,
  onCreated,
  onError,
}: {
  projectId: string;
  onCreated: (rule: EscalationRuleDto) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useT();
  const auth = useAuth();
  const [type, setType] = useState<EscalationRuleTypeValue>("low_confidence");
  const [priority, setPriority] = useState(70);
  const [action, setAction] = useState<EscalationActionValue>("handoff");
  const [threshold, setThreshold] = useState("0.55");
  const [patterns, setPatterns] = useState("");
  const [intent, setIntent] = useState("");
  const [maxFallbacks, setMaxFallbacks] = useState("2");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const buildParams = (): Record<string, unknown> | null => {
    switch (type) {
      case "low_confidence": {
        const value = Number(threshold);
        if (Number.isNaN(value)) return null;
        return { threshold: value };
      }
      case "keyword": {
        const list = patterns.split(",").map((s) => s.trim()).filter((s) => s !== "");
        if (list.length === 0) return null;
        return { patterns: list };
      }
      case "intent":
        return intent.trim() !== "" ? { intent: intent.trim() } : null;
      case "no_answer": {
        const value = Number(maxFallbacks);
        if (Number.isNaN(value)) return null;
        return { max_fallbacks: value };
      }
      default:
        return {};
    }
  };

  const submit = async (): Promise<void> => {
    const params = buildParams();
    if (params === null) {
      setLocalError(t("common.error"));
      return;
    }
    setBusy(true);
    setLocalError(null);
    onError(null);
    try {
      const res = await api.createRule(projectId, { priority, type, params, action, enabled: true });
      onCreated(res.rule);
    } catch (err) {
      if (err instanceof ApiError && err.code === "RULE_PRIORITY_TAKEN") {
        onError(t("rules.priorityTaken"));
        return;
      }
      auth.onApiError(err);
      onError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h4>{t("rules.add")}</h4>
      <div className="form-grid">
        <Field label={t("rules.table.type")}>
          <select value={type} onChange={(e) => setType(e.target.value as EscalationRuleTypeValue)}>
            {RULE_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {t(`rules.type.${rt}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("rules.table.priority")}>
          <input type="number" min={1} max={1000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
        </Field>
        <Field label={t("rules.table.action")}>
          <select value={action} onChange={(e) => setAction(e.target.value as EscalationActionValue)}>
            {RULE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`rules.action.${a}`)}
              </option>
            ))}
          </select>
        </Field>
        {type === "low_confidence" && (
          <Field label={t("rules.threshold")}>
            <input type="number" min={0} max={1} step={0.05} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
        )}
        {type === "keyword" && (
          <Field label={t("rules.patternsHint")}>
            <input value={patterns} onChange={(e) => setPatterns(e.target.value)} placeholder="оператор, менеджер" />
          </Field>
        )}
        {type === "intent" && (
          <Field label={t("rules.intentLabel")}>
            <input value={intent} onChange={(e) => setIntent(e.target.value)} />
          </Field>
        )}
        {type === "no_answer" && (
          <Field label={t("rules.maxFallbacks")}>
            <input type="number" min={1} max={10} value={maxFallbacks} onChange={(e) => setMaxFallbacks(e.target.value)} />
          </Field>
        )}
      </div>
      <ErrorText text={localError} />
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? t("common.saving") : t("rules.add")}
      </button>
    </form>
  );
}
