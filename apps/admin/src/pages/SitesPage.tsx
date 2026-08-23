/**
 * /projects/:id/sites — сайты проекта (Ф5, docs/22 §2).
 * Карточка: имя, домен, origins (списком строк), widget-конструктор
 * (акцент/приветствие/положение/язык — WidgetConfig из packages/shared),
 * кнопки: Сохранить (PATCH), Регенерировать ключ (confirm), Показать сниппет.
 *
 * Контракт sites REST добавляется на бэкенде параллельно: до его появления
 * страница честно показывает пустое состояние при 404.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type { SiteDto, SiteWidgetConfig } from "../api/types";
import { api, useAuth } from "../state/auth";
import { useProjectRouteId } from "../components/Layout";
import { ConfirmDialog, CopyButton, ErrorText, Field, Modal } from "../components/ui";

/**
 * Сниппет установки (docs/10 §1). Origin API берётся из VITE_API_ORIGIN,
 * иначе — из адреса админки. В dev-прокси (:5173) /widget.js не проксируется —
 * без явной переменной сниппет вёл на 404 (аудит IR-059).
 */
export function buildSnippet(publicKey: string): string {
  const apiOrigin =
    (import.meta.env?.VITE_API_ORIGIN as string | undefined) ?? window.location.origin;
  return `<script src="${apiOrigin}/widget.js" data-chat-key="${publicKey}" defer></script>`;
}

interface SiteDraft {
  name: string;
  domain: string;
  originsText: string;
  accent: string;
  greeting: string;
  position: "right" | "left";
  locale: string;
}

function draftOf(site: SiteDto): SiteDraft {
  const cfg = site.widget_config ?? {};
  return {
    name: site.name,
    domain: site.domain,
    originsText: (site.allowed_origins ?? []).join("\n"),
    accent: cfg.theme?.accent ?? "#4f46e5",
    greeting: cfg.greeting ?? "",
    position: cfg.theme?.position === "left" ? "left" : "right",
    locale: cfg.locale ?? "ru",
  };
}

function draftToPatch(draft: SiteDraft): {
  name: string;
  domain: string;
  allowed_origins: string[];
  widget_config: SiteWidgetConfig;
} {
  return {
    name: draft.name.trim(),
    domain: draft.domain.trim(),
    allowed_origins: draft.originsText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
    widget_config: {
      locale: draft.locale,
      greeting: draft.greeting,
      theme: { accent: draft.accent, position: draft.position },
    },
  };
}

export function SitesPage() {
  const { t } = useT();
  const auth = useAuth();
  const projectId = useProjectRouteId();

  const [sites, setSites] = useState<SiteDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);

  const [creating, setCreating] = useState(false);
  const [snippetSite, setSnippetSite] = useState<SiteDto | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  // Черновики карточек: id → поля формы.
  const [drafts, setDrafts] = useState<Record<string, SiteDraft>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (projectId === null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSites(projectId);
      setSites(res.sites);
      setNotAvailable(false);
      const nextDrafts: Record<string, SiteDraft> = {};
      for (const site of res.sites) nextDrafts[site.id] = draftOf(site);
      setDrafts(nextDrafts);
    } catch (err) {
      auth.onApiError(err);
      if (err instanceof ApiError && err.status === 404) {
        setNotAvailable(true);
        setSites([]);
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

  const patchDraft = (id: string, patch: Partial<SiteDraft>): void => {
    setDrafts((prev) => {
      const current = prev[id];
      if (current === undefined) return prev;
      return { ...prev, [id]: { ...current, ...patch } };
    });
  };

  const save = async (site: SiteDto): Promise<void> => {
    const draft = drafts[site.id];
    if (draft === undefined) return;
    setSavingIds((prev) => new Set(prev).add(site.id));
    setCardErrors((prev) => ({ ...prev, [site.id]: "" }));
    try {
      const res = await api.updateSite(site.id, draftToPatch(draft));
      setSites((prev) => prev.map((s) => (s.id === site.id ? res.site : s)));
    } catch (err) {
      auth.onApiError(err);
      setCardErrors((prev) => ({ ...prev, [site.id]: describeApiError(err) }));
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(site.id);
        return next;
      });
    }
  };

  const regenerate = async (siteId: string): Promise<void> => {
    setRegeneratingId(null);
    try {
      const res = await api.regenerateSiteKey(siteId);
      setSites((prev) => prev.map((s) => (s.id === siteId ? res.site : s)));
      if (res.site.widget_public_key !== "") setSnippetSite(res.site);
    } catch (err) {
      auth.onApiError(err);
      setCardErrors((prev) => ({ ...prev, [siteId]: describeApiError(err) }));
    }
  };

  if (projectId === null) return <div className="page-card"><p className="muted pad">{t("project.none")}</p></div>;

  return (
    <div className="page-card">
      <div className="page-head">
        <h2>{t("sites.title")}</h2>
        <span className="spacer" />
        <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
          {t("common.refresh")}
        </button>
        <button className="btn primary" type="button" onClick={() => setCreating(true)}>
          {t("sites.add")}
        </button>
      </div>

      <ErrorText text={error} />

      {loading && sites.length === 0 && <p className="muted pad">{t("common.loading")}</p>}
      {!loading && notAvailable && <p className="muted pad">{t("sites.notFound")}</p>}
      {!loading && !notAvailable && error === null && sites.length === 0 && (
        <p className="muted pad">{t("sites.empty")}</p>
      )}

      <div className="sites-grid">
        {sites.map((site) => {
          const draft = drafts[site.id];
          if (draft === undefined) return null;
          return (
            <article key={site.id} className="site-card">
              <header className="site-head">
                <strong>{site.name}</strong>
                <span className={`chip ${site.is_active ? "st-ready" : ""}`}>{site.is_active ? t("sites.active") : t("sites.inactive")}</span>
              </header>
              <p className="muted small">
                {t("sites.domain")}: {site.domain}
              </p>

              <Field label={t("common.name")}>
                <input value={draft.name} onChange={(e) => patchDraft(site.id, { name: e.target.value })} />
              </Field>
              <Field label={t("sites.domain")}>
                <input value={draft.domain} onChange={(e) => patchDraft(site.id, { domain: e.target.value })} />
              </Field>
              <Field label={t("sites.origins")} hint={t("sites.originsHint")}>
                <textarea
                  rows={3}
                  value={draft.originsText}
                  onChange={(e) => patchDraft(site.id, { originsText: e.target.value })}
                  placeholder={"https://example.com\nhttps://www.example.com"}
                />
              </Field>

              <fieldset className="widget-builder">
                <legend>{t("sites.widgetBuilder")}</legend>
                <div className="form-grid">
                  <Field label={t("sites.accent")}>
                    <span className="color-row">
                      <input
                        type="color"
                        value={draft.accent}
                        onChange={(e) => patchDraft(site.id, { accent: e.target.value })}
                      />
                      <input
                        type="text"
                        value={draft.accent}
                        onChange={(e) => patchDraft(site.id, { accent: e.target.value })}
                      />
                    </span>
                  </Field>
                  <Field label={t("sites.position")}>
                    <select
                      value={draft.position}
                      onChange={(e) =>
                        patchDraft(site.id, { position: e.target.value === "left" ? "left" : "right" })
                      }
                    >
                      <option value="right">{t("sites.position.right")}</option>
                      <option value="left">{t("sites.position.left")}</option>
                    </select>
                  </Field>
                  <Field label={t("sites.locale")}>
                    <select value={draft.locale} onChange={(e) => patchDraft(site.id, { locale: e.target.value })}>
                      <option value="ru">ru</option>
                      <option value="en">en</option>
                    </select>
                  </Field>
                </div>
                <Field label={t("sites.greeting")}>
                  <input
                    value={draft.greeting}
                    maxLength={500}
                    onChange={(e) => patchDraft(site.id, { greeting: e.target.value })}
                  />
                </Field>
              </fieldset>

              <ErrorText text={cardErrors[site.id] ?? null} />

              <div className="actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={savingIds.has(site.id)}
                  onClick={() => void save(site)}
                >
                  {savingIds.has(site.id) ? t("common.saving") : t("sites.save")}
                </button>
                <button className="btn" type="button" onClick={() => setRegeneratingId(site.id)}>
                  {t("sites.regenerate")}
                </button>
                <button className="btn" type="button" onClick={() => setSnippetSite(site)}>
                  {t("sites.snippet")}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {creating && (
        <CreateSiteModal
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(site) => {
            setCreating(false);
            setSites((prev) => [...prev, site]);
            setDrafts((prev) => ({ ...prev, [site.id]: draftOf(site) }));
            setSnippetSite(site);
          }}
        />
      )}

      {snippetSite !== null && (
        <Modal title={t("sites.snippetTitle")} onClose={() => setSnippetSite(null)}>
          <p className="muted small">
            {t("sites.publicKey")}: <code>{snippetSite.widget_public_key}</code>
          </p>
          <p className="muted small">{t("sites.snippetHint")}</p>
          {/* Сниппет как текст (textContent/pre) — XSS-безопасно */}
          <CopyButton text={buildSnippet(snippetSite.widget_public_key)} />
        </Modal>
      )}

      {regeneratingId !== null && (
        <ConfirmDialog
          title={t("sites.regenerate")}
          body={t("sites.regenerateConfirm")}
          onCancel={() => setRegeneratingId(null)}
          onConfirm={() => void regenerate(regeneratingId)}
        />
      )}
    </div>
  );
}

function CreateSiteModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (site: SiteDto) => void;
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
    if (busy) return;
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
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("sites.createTitle")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="modal-form"
      >
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
        <Field label={t("sites.origins")} hint={t("sites.originsHint")}>
          <textarea rows={3} value={originsText} onChange={(e) => setOriginsText(e.target.value)} />
        </Field>
        <ErrorText text={error} />
        <div className="modal-actions">
          <button className="btn" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? t("common.saving") : t("common.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
