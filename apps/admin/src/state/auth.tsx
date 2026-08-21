/**
 * Сессия администратора (docs/15 §1): восстановление по httpOnly-cookie при
 * загрузке, вход/выход, реакция на 401 в любом запросе (сессия истекла).
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
import { AdminApi, ApiError } from "../api/client";
import type { AuthedUser } from "../api/types";

/** Единственный экземпляр API-клиента приложения. */
export const api = new AdminApi();

export interface AuthApi {
  user: AuthedUser | null;
  booting: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Повторно читает /auth/me (например, после POST /setup — сервер сам логинит). */
  refresh(): Promise<void>;
  /** Вызывать в catch любого запроса: 401 → разлогин (редирект на /login). */
  onApiError(err: unknown): void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [booting, setBooting] = useState(true);

  // Восстановление сессии по cookie (GET /auth/me).
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        // не авторизованы — остаёмся null
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email.trim(), password);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // сессия могла истечь — всё равно выходим
    }
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const res = await api.me();
    setUser(res.user);
  }, []);

  const onApiError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) setUser(null);
  }, []);

  const value = useMemo<AuthApi>(
    () => ({ user, booting, login, logout, refresh, onApiError }),
    [user, booting, login, logout, refresh, onApiError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("AuthProvider отсутствует над деревом");
  return ctx;
}
