/**
 * /projects/:id/dashboard — аналитика MVP (docs/30 §Ф5): карточки-числа
 * (диалоги, handoff rate, решено AI, латентность), столбчатая диаграмма
 * «диалоги/сутки» на CSS-барах, топ низкой релевантности.
 * Данные: GET /projects/:id/analytics?days=14 (endpoint добавляется параллельно;
 * до появления — пустое состояние при 404).
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type { ProjectAnalyticsDto } from "../api/types";
import { api, useAuth } from "../state/auth";
import { useProjectRouteId } from "../components/Layout";
import { ErrorText } from "../components/ui";

const DAYS = 14;

export function DashboardPage() {
  const { t } = useT();
  const auth = useAuth();
  const projectId = useProjectRouteId();

  const [data, setData] = useState<ProjectAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (projectId === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAnalytics(projectId, DAYS);
      setData(res.analytics);
      setNotAvailable(false);
    } catch (err) {
      auth.onApiError(err);
      if (err instanceof ApiError && err.status === 404) {
        setNotAvailable(true);
        setData(null);
      } else {
        setError(describeApiError(err));
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, auth]);

  useEffect(() => {
    void load();
  }, [load]);

  if (projectId === null)
    return <div className="page-card"><p className="muted pad">{t("project.none")}</p></div>;

  // Защитное чтение: null-поля (нет данных за период) → «—».
  const totals = data?.totals;
  const conversations = typeof totals?.conversations === "number" ? totals.conversations : null;
  const handoffRate =
    typeof totals?.handoff_rate === "number" ? Math.round(totals.handoff_rate * 100) : null;
  const aiResolvedShare =
    typeof totals?.ai_resolved_share === "number" ? Math.round(totals.ai_resolved_share * 100) : null;
  const latency =
    typeof totals?.avg_first_response_ms === "number" ? totals.avg_first_response_ms : null;

  const perDay = data?.days ?? [];
  const maxDay = perDay.reduce((max, point) => Math.max(max, point.conversations), 0);
  const lowRelevance = data?.low_relevance_top ?? [];

  return (
    <div className="page-card">
      <div className="page-head">
        <h2>{t("dash.title")}</h2>
        <span className="muted small">{t("dash.period", { params: { days: DAYS } })}</span>
        <span className="spacer" />
        <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
          {t("common.refresh")}
        </button>
      </div>

      <ErrorText text={error} />

      {loading && data === null && <p className="muted pad">{t("common.loading")}</p>}
      {!loading && notAvailable && <p className="muted pad">{t("common.notFoundBackend")}</p>}
      {!loading && !notAvailable && data !== null && conversations === 0 && (
        <p className="muted pad">{t("dash.empty")}</p>
      )}

      <div className="stat-grid">
        <StatCard label={t("dash.conversations")} value={conversations !== null ? String(conversations) : null} />
        <StatCard
          label={t("dash.handoffRate")}
          value={handoffRate !== null ? t("dash.percent", { params: { value: handoffRate } }) : null}
        />
        <StatCard
          label={t("dash.aiResolved")}
          value={aiResolvedShare !== null ? t("dash.percent", { params: { value: aiResolvedShare } }) : null}
        />
        <StatCard
          label={t("dash.latency")}
          value={latency !== null ? t("dash.ms", { params: { ms: latency } }) : null}
        />
      </div>

      {perDay.length > 0 && (
        <section className="chart-section">
          <h3>{t("dash.perDay")}</h3>
          {/* Столбчатая диаграмма на CSS/flex — без chart-библиотек */}
          <div className="bar-chart" role="img" aria-label={t("dash.perDay")}>
            {perDay.map((point) => (
              <div key={point.date} className="bar-col" title={`${point.date}: ${point.conversations}`}>
                <div
                  className="bar"
                  style={{ height: `${maxDay > 0 ? Math.max(4, Math.round((point.conversations / maxDay) * 100)) : 4}%` }}
                />
                <span className="bar-label">{point.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="chart-section">
        <h3>{t("dash.lowRelevance")}</h3>
        {lowRelevance.length === 0 ? (
          <p className="muted pad">{t("dash.lowRelevanceEmpty")}</p>
        ) : (
          <ol className="low-rel-list">
            {lowRelevance.map((item, index) => (
              <li key={`${item.text}-${index}`}>
                <span className="entity-title">{item.text}</span>
                <span className="chip">{t("dash.count", { params: { count: item.count } })}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="stat-card">
      <span className="stat-value">{value ?? "—"}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
