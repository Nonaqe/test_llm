/**
 * Экран логина (docs/15 §1): email+пароль → httpOnly-cookie сессия.
 * После входа — возврат на исходный защищённый маршрут, если он был.
 */
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import { useAuth } from "../state/auth";

export function LoginPage() {
  const { t } = useT();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from =
    typeof (location.state as { from?: unknown } | null)?.from === "string"
      ? ((location.state as { from: string }).from)
      : "/inbox";

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(email, password);
      void navigate(from, { replace: true });
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-wrap">
      <form
        className="login-card"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <h1>{t("app.name")}</h1>
        <p className="login-sub">{t("login.subtitle")}</p>
        <label className="field">
          <span>{t("common.email")}</span>
          <input
            type="email"
            value={email}
            required
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("common.password")}</span>
          <input
            type="password"
            value={password}
            required
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error !== null && <p className="error-text">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? t("login.submitting") : t("login.submit")}
        </button>
        <p className="muted login-wizard-hint">
          {t("login.wizardHint")}{" "}
          <Link to="/wizard">{t("login.wizardLink")}</Link>
        </p>
      </form>
    </main>
  );
}
