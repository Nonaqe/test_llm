/**
 * Каркас панели Ф5: сайдбар-навигация + шапка (переключатель проекта,
 * язык ru/en, пользователь). Защищённые страницы рендерятся в <Outlet />.
 */
import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n";
import { useAuth } from "../state/auth";
import { useProjects } from "../state/projects";

/**
 * Для страниц /projects/:projectId/*: синхронизирует :projectId из URL
 * с контекстом проектов и возвращает актуальный id (или null).
 */
export function useProjectRouteId(): string | null {
  const { projectId } = useParams<{ projectId?: string }>();
  const { currentId, setCurrentId } = useProjects();
  const fromUrl = typeof projectId === "string" && projectId !== "" ? projectId : null;

  useEffect(() => {
    if (fromUrl !== null && fromUrl !== currentId) setCurrentId(fromUrl);
  }, [fromUrl, currentId, setCurrentId]);

  return fromUrl ?? currentId;
}

export function Layout() {
  const { t, locale, setLocale } = useT();
  const auth = useAuth();
  const projects = useProjects();
  const navigate = useNavigate();
  const location = useLocation();

  const switchProject = (id: string): void => {
    // На проектной странице меняем URL (страница сама перезагрузит данные),
    // вне проектных — просто выбираем проект для сайдбара.
    const match = location.pathname.match(/^\/projects\/([^/]+)(\/.*)?$/);
    if (match !== null) {
      void navigate(`/projects/${id}${match[2] ?? ""}`);
    } else {
      projects.setCurrentId(id);
    }
  };

  const logout = (): void => {
    void auth.logout().then(() => {
      void navigate("/login", { replace: true });
    });
  };

  const pid = projects.currentId;
  const projectBase = pid !== null ? `/projects/${pid}` : "/projects";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">{t("app.name")}</div>
        <nav className="side-nav">
          <NavLink to="/inbox" className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
            {t("nav.inbox")}
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
            {t("nav.projects")}
          </NavLink>

          <div className="side-section">{t("nav.section.project")}</div>
          <SideProjectLink to={`${projectBase}/dashboard`} enabled={pid !== null} label={t("nav.dashboard")} />
          <SideProjectLink to={`${projectBase}/sites`} enabled={pid !== null} label={t("nav.sites")} />
          <SideProjectLink to={`${projectBase}/assistant`} enabled={pid !== null} label={t("nav.assistant")} />
          <SideProjectLink to={`${projectBase}/knowledge`} enabled={pid !== null} label={t("nav.knowledge")} />
          <SideProjectLink to={`${projectBase}/sandbox`} enabled={pid !== null} label={t("nav.sandbox")} />

          <div className="side-section">{t("nav.section.installation")}</div>
          <NavLink to="/team" className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
            {t("nav.team")}
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
            {t("nav.settings")}
          </NavLink>
          <NavLink to="/wizard" className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
            {t("nav.wizard")}
          </NavLink>
        </nav>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <select
            className="project-select"
            value={pid ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id !== "") switchProject(id);
            }}
            aria-label={t("project.select")}
          >
            {projects.projects.length === 0 && <option value="">{t("project.none")}</option>}
            {projects.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <span className="lang-switch" role="group" aria-label={t("common.language")}>
            <button
              type="button"
              className={`lang-btn${locale === "ru" ? " active" : ""}`}
              onClick={() => setLocale("ru")}
            >
              RU
            </button>
            <button
              type="button"
              className={`lang-btn${locale === "en" ? " active" : ""}`}
              onClick={() => setLocale("en")}
            >
              EN
            </button>
          </span>
          <span className="who">
            {auth.user !== null && (auth.user.name !== "" ? auth.user.name : auth.user.email)}
          </span>
          <button className="btn light" type="button" onClick={logout}>
            {t("common.logout")}
          </button>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SideProjectLink({ to, enabled, label }: { to: string; enabled: boolean; label: string }) {
  if (!enabled) {
    return (
      <span className="side-link disabled" title={label}>
        {label}
      </span>
    );
  }
  return (
    <NavLink to={to} className={({ isActive }) => `side-link${isActive ? " active" : ""}`}>
      {label}
    </NavLink>
  );
}
