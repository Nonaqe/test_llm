/**
 * Список доступных проектов (GET /projects) и текущий выбранный проект
 * для шапки-переключателя и проектных страниц. Выбор хранится в localStorage.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { describeApiError } from "../format";
import type { ProjectSummary } from "../api/types";
import { api, useAuth } from "./auth";

const PROJECT_STORAGE_KEY = "unichat.admin.project";

export interface ProjectsApi {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  currentId: string | null;
  setCurrentId(id: string | null): void;
  reload(): Promise<void>;
}

const ProjectsContext = createContext<ProjectsApi | null>(null);

function readStoredProjectId(): string | null {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentIdState] = useState<string | null>(() => readStoredProjectId());

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listProjects();
      setProjects(res.projects);
      setCurrentIdState((prev) => {
        const stillThere = prev !== null && res.projects.some((p) => p.id === prev);
        if (stillThere) return prev;
        return res.projects[0]?.id ?? null;
      });
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Проекты имеют смысл только для авторизованного пользователя.
  useEffect(() => {
    if (user === null) {
      setProjects([]);
      setCurrentIdState(null);
      setError(null);
      return;
    }
    void reload();
  }, [user, reload]);

  const setCurrentId = useCallback((id: string | null) => {
    setCurrentIdState(id);
    try {
      if (id === null) window.localStorage.removeItem(PROJECT_STORAGE_KEY);
      else window.localStorage.setItem(PROJECT_STORAGE_KEY, id);
    } catch {
      // localStorage недоступен — выбор живёт до перезагрузки
    }
  }, []);

  const value = useMemo<ProjectsApi>(
    () => ({ projects, loading, error, currentId, setCurrentId, reload }),
    [projects, loading, error, currentId, setCurrentId, reload],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsApi {
  const ctx = useContext(ProjectsContext);
  if (ctx === null) throw new Error("ProjectsProvider отсутствует над деревом");
  return ctx;
}
