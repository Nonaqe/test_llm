/**
 * /diagnostics — страница диагностики установки (Фаза 7, docs/30 §Ф7):
 * карточки «Версии» (API/node/аптайм), «Статусы» (db/redis/AI-провайдер
 * с цветными бейджами), «Последний бэкап» (дата, размер, ok/ошибка) и
 * кнопка ручного бэкапа. Данные: GET /diagnostics; автообновление каждые 30 с.
 * Endpoint добавляется параллельно на бэкенде — до появления пустое состояние.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import type { ComponentStatusValue, DiagnosticsDto } from "../api/types";
import { describeApiError } from "../format";
import { useT, type I18nApi, type Locale } from "../i18n";
import { api, useAuth } from "../state/auth";
import { ErrorText } from "../components/ui";

const REFRESH_MS = 30_000;

/** Подпись функции перевода из useT() — для локальных хелперов форматирования. */
type TranslateFn = I18nApi["t"];

export function DiagnosticsPage() {
  const { t, locale } = useT();
  const auth = useAuth();

  const [data, setData] = useState<DiagnosticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);
  // Отдельные состояния кнопки/сообщения ручного бэкапа — чтобы автолоад
  // не затирал результат последнего запуска.
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupDone, setBackupDone] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDiagnostics();
      setData(res);
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
  }, [auth]);

  useEffect(() => {
    void load();
    // Автообновление каждые 30 с (docs/30 §Ф7); очистка при размонтировании.
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  /** Кнопка «Сделать бэкап сейчас»: результат обновляет карточку last_backup. */
  const runBackup = async (): Promise<void> => {
    setBackupRunning(true);
    setBackupError(null);
    setBackupDone(false);
    try {
      const res = await api.triggerBackup();
      setData((prev) => (prev === null ? prev : { ...prev, last_backup: res }));
      setBackupDone(true);
    } catch (err) {
      auth.onApiError(err);
      setBackupError(describeApiError(err));
    } finally {
      setBackupRunning(false);
    }
  };

  return (
    <div className="page-card">
      <div className="page-head">
        <h2>{t("diag.title")}</h2>
        <span className="muted small">{t("diag.autoRefresh")}</span>
        <span className="spacer" />
        <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
          {t("common.refresh")}
        </button>
      </div>

      <ErrorText text={error} />

      {loading && data === null && !notAvailable && <p className="muted pad">{t("common.loading")}</p>}
      {!loading && notAvailable && <p className="muted pad">{t("common.notFoundBackend")}</p>}

      {data !== null && (
        <div className="diag-grid">
          {/* --- Версии --- */}
          <section className="chart-section">
            <h3>{t("diag.versions.title")}</h3>
            <dl className="diag-rows">
              <div className="diag-row">
                <dt>{t("diag.versions.api")}</dt>
                <dd>{data.version}</dd>
              </div>
              <div className="diag-row">
                <dt>{t("diag.versions.node")}</dt>
                <dd>{data.node}</dd>
              </div>
              <div className="diag-row">
                <dt>{t("diag.versions.uptime")}</dt>
                <dd>{formatUptime(data.uptime_s, t)}</dd>
              </div>
            </dl>
          </section>

          {/* --- Статусы сервисов --- */}
          <section className="chart-section">
            <h3>{t("diag.status.title")}</h3>
            <dl className="diag-rows">
              <div className="diag-row">
                <dt>{t("diag.status.db")}</dt>
                <dd>
                  <StatusBadge status={data.db} t={t} />
                </dd>
              </div>
              <div className="diag-row">
                <dt>{t("diag.status.redis")}</dt>
                <dd>
                  <StatusBadge status={data.redis} t={t} />
                </dd>
              </div>
              <div className="diag-row">
                <dt>{t("diag.status.provider")}</dt>
                <dd>
                  {data.provider_kind === null ? (
                    <StatusBadge status="not_configured" t={t} />
                  ) : (
                    <span className="chip diag-ok">{data.provider_kind}</span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {/* --- Последний бэкап --- */}
          <section className="chart-section">
            <h3>{t("diag.backup.title")}</h3>
            <BackupCard backup={data.last_backup} locale={locale} />
            <div className="diag-backup-actions">
              <button
                className="btn primary"
                type="button"
                onClick={() => void runBackup()}
                disabled={backupRunning}
              >
                {backupRunning ? t("diag.backup.running") : t("diag.backup.run")}
              </button>
              {backupDone && <span className="ok-text">{t("diag.backup.done")}</span>}
            </div>
            <ErrorText text={backupError} />
          </section>
        </div>
      )}
    </div>
  );
}

/** Цветной бейдж статуса компонента: ok/error/not_configured. */
function StatusBadge({ status, t }: { status: ComponentStatusValue; t: TranslateFn }) {
  return (
    <span className={`chip diag-${status}`}>
      {status === "ok"
        ? t("diag.status.ok")
        : status === "error"
          ? t("diag.status.error")
          : t("diag.status.notConfigured")}
    </span>
  );
}

function BackupCard({
  backup,
  locale,
}: {
  backup: DiagnosticsDto["last_backup"];
  locale: Locale;
}) {
  const { t } = useT();

  if (backup === null) {
    return <p className="muted pad">{t("diag.backup.none")}</p>;
  }

  if (!backup.ok) {
    return (
      <div className="diag-rows">
        <p className="error-text">{t("diag.backup.failed")}: {backup.error}</p>
      </div>
    );
  }

  const when = new Date(backup.at_iso);
  const dateText = Number.isNaN(when.getTime())
    ? backup.at_iso
    : when.toLocaleString(locale === "ru" ? "ru-RU" : "en-US");

  return (
    <dl className="diag-rows">
      <div className="diag-row">
        <dt>{t("diag.backup.at")}</dt>
        <dd>{dateText}</dd>
      </div>
      <div className="diag-row">
        <dt>{t("diag.backup.size")}</dt>
        <dd>{formatBackupSize(backup.size_bytes, t)}</dd>
      </div>
      <div className="diag-row">
        <dt>{t("diag.backup.dumpFile")}</dt>
        <dd className="diag-file">{backup.dump_file}</dd>
      </div>
      <div className="diag-row">
        <dt>{t("diag.backup.uploadsFile")}</dt>
        <dd className="diag-file">{backup.uploads_file ?? "—"}</dd>
      </div>
      <div className="diag-row">
        <dt>{t("common.status")}</dt>
        <dd>
          <span className="chip diag-ok">{t("diag.backup.ok")}</span>
        </dd>
      </div>
    </dl>
  );
}

/** Аптайм человекочитаемо: «2 дн. 5 ч. 13 мин.» / «4 мин. 32 с». */
function formatUptime(seconds: number, t: TranslateFn): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(t("diag.uptime.d", { params: { n: days } }));
  if (hours > 0) parts.push(t("diag.uptime.h", { params: { n: hours } }));
  if (minutes > 0 && days === 0) parts.push(t("diag.uptime.m", { params: { n: minutes } }));
  if (parts.length === 0 || (days === 0 && hours === 0)) {
    parts.push(t("diag.uptime.s", { params: { n: secs } }));
  }
  return parts.join(" ");
}

/** Размер бэкапа: МБ (одна десятая) от 1 МБ, иначе КБ. */
function formatBackupSize(bytes: number, t: TranslateFn): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return t("diag.size.mb", { params: { mb: Math.round(mb * 10) / 10 } });
  }
  return t("diag.size.kb", { params: { kb: Math.max(1, Math.round(bytes / 1024)) } });
}
