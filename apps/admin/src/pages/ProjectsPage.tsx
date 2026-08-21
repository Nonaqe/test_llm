/**
 * /projects — список доступных проектов (GET /projects) + создание
 * (POST /projects {name}; доступно администраторам установки — docs/15 §2).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { describeApiError, formatTime } from "../format";
import { useT } from "../i18n";
import { api, useAuth } from "../state/auth";
import { useProjects } from "../state/projects";
import { ErrorText, Field } from "../components/ui";

export function ProjectsPage() {
  const { t } = useT();
  const auth = useAuth();
  const projects = useProjects();

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createProject(trimmed);
      setName("");
      await projects.reload();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const reload = useCallback(() => {
    void projects.reload();
  }, [projects]);

  useEffect(() => {
    // Проекты могли измениться на другой странице — обновляем при входе.
    reload();
  }, [reload]);

  return (
    <div className="page-card">
      <div className="page-head">
        <h2>{t("projects.title")}</h2>
        <button className="btn" type="button" onClick={reload} disabled={projects.loading}>
          {t("common.refresh")}
        </button>
      </div>

      <ErrorText text={error ?? projects.error} />

      {projects.projects.length === 0 && !projects.loading && (
        <p className="muted pad">{t("projects.empty")}</p>
      )}

      <ul className="entity-list">
        {projects.projects.map((p) => (
          <li key={p.id} className="entity-card">
            <div className="entity-main">
              <span className="entity-title">{p.name}</span>
              {p.created_at !== undefined && (
                <span className="muted small">{t("projects.createdAt", { params: { date: formatTime(p.created_at) } })}</span>
              )}
            </div>
            <Link className="btn primary" to={`/projects/${p.id}/sites`}>
              {t("projects.open")}
            </Link>
          </li>
        ))}
      </ul>

      <form
        className="inline-form"
        onSubmit={(e) => {
          void create(e);
        }}
      >
        <h3>{t("projects.createTitle")}</h3>
        <Field label={t("common.name")}>
          <input
            value={name}
            required
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("projects.createTitle")}
          />
        </Field>
        <button className="btn primary" type="submit" disabled={busy || name.trim() === ""}>
          {busy ? t("common.saving") : t("projects.createBtn")}
        </button>
      </form>
    </div>
  );
}
