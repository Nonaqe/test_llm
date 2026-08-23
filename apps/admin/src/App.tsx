/**
 * Universal Chat Admin — Фаза 5 (docs/30 §Ф5).
 *
 * Маршрутизация на react-router-dom (BrowserRouter):
 *   /login — вход;
 *   /wizard — визард первого входа (доступен и без сессии — шаг setup);
 *   /inbox — панель оператора из Ф4 (функциональность сохранена);
 *   /projects, /projects/:id/{sites|assistant|knowledge|dashboard|sandbox},
 *   /team, /settings, /diagnostics — страницы панели (Ф7: диагностика).
 * Защищённые маршруты: без валидной сессии (me/401) → редирект /login.
 */
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useT } from "./i18n";
import { AssistantPage } from "./pages/AssistantPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { InboxPage } from "./pages/InboxPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SandboxPage } from "./pages/SandboxPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SitesPage } from "./pages/SitesPage";
import { TeamPage } from "./pages/TeamPage";
import { WizardPage } from "./pages/WizardPage";
import { AuthProvider, useAuth } from "./state/auth";
import { I18nProvider } from "./state/i18n";
import { ProjectsProvider } from "./state/projects";

/** Защищённый маршрут: пока me не ответил — boot; без сессии — /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, booting } = useAuth();
  const location = useLocation();
  const { t } = useT();

  if (booting) return <div className="boot">{t("app.loading")}</div>;
  if (user === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <ProjectsProvider>
          {/* basename из vite base: прод-сборка собирается с ADMIN_BASE_PATH=/admin */}
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/+$/, "") || undefined}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/wizard" element={<WizardPage />} />

              <Route
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<Navigate to="/inbox" replace />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectId/sites" element={<SitesPage />} />
                <Route path="/projects/:projectId/assistant" element={<AssistantPage />} />
                <Route path="/projects/:projectId/knowledge" element={<KnowledgePage />} />
                <Route path="/projects/:projectId/dashboard" element={<DashboardPage />} />
                <Route path="/projects/:projectId/sandbox" element={<SandboxPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/diagnostics" element={<DiagnosticsPage />} />
                <Route path="*" element={<Navigate to="/inbox" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ProjectsProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
