/**
 * /projects/:id/knowledge — база знаний (docs/22 §4, docs/12).
 * Загрузка: drag&drop + кнопка (pdf/docx/txt/csv/md → multipart POST),
 * формы URL/текста; список документов со статусами (polling 5 c, пока есть
 * indexing/pending); reindex/delete; вкладка FAQ (CRUD).
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type { DocumentStatusValue, FaqDto, KnowledgeDocumentDto } from "../api/types";
import { api, useAuth } from "../state/auth";
import { useProjectRouteId } from "../components/Layout";
import { ConfirmDialog, ErrorText, Field } from "../components/ui";

const ACCEPT = ".pdf,.docx,.txt,.csv,.md";
const POLL_MS = 5000;

const ACTIVE_STATUSES: readonly DocumentStatusValue[] = ["pending", "parsing", "indexing"];

export function KnowledgePage() {
  const { t } = useT();
  const auth = useAuth();
  const projectId = useProjectRouteId();

  const [tab, setTab] = useState<"documents" | "faq">("documents");
  const [documents, setDocuments] = useState<KnowledgeDocumentDto[]>([]);
  const [faqs, setFaqs] = useState<FaqDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [deletingFaqId, setDeletingFaqId] = useState<string | null>(null);

  const loadDocuments = useCallback(async (): Promise<void> => {
    if (projectId === null) return;
    try {
      const res = await api.listDocuments(projectId);
      setDocuments(res.documents);
      setError(null);
    } catch (err) {
      auth.onApiError(err);
      if (!(err instanceof ApiError && err.status === 404)) {
        setError(describeApiError(err));
      }
    }
  }, [projectId, auth]);

  const loadFaqs = useCallback(async (): Promise<void> => {
    if (projectId === null) return;
    try {
      const res = await api.listFaqs(projectId);
      setFaqs(res.faqs);
    } catch (err) {
      auth.onApiError(err);
    }
  }, [projectId, auth]);

  useEffect(() => {
    if (projectId === null) return;
    setLoading(true);
    void Promise.all([loadDocuments(), loadFaqs()]).finally(() => setLoading(false));
  }, [projectId, loadDocuments, loadFaqs]);

  // Polling статусов каждые 5 c — только пока есть документы в обработке.
  useEffect(() => {
    if (projectId === null) return;
    const hasActive = documents.some((d) => ACTIVE_STATUSES.includes(d.status));
    if (!hasActive) return;
    const timer = window.setInterval(() => {
      void loadDocuments();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [documents, projectId, loadDocuments]);

  const uploadFiles = async (files: FileList | File[]): Promise<void> => {
    if (projectId === null) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await api.uploadDocument(projectId, file);
      }
      await loadDocuments();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
  };

  const reindex = async (docId: string): Promise<void> => {
    if (projectId === null) return;
    setError(null);
    try {
      await api.reindexDocument(projectId, docId);
      await loadDocuments();
    } catch (err) {
      auth.onApiError(err);
      setError(describeApiError(err));
    }
  };

  const deleteDocument = async (docId: string): Promise<void> => {
    if (projectId === null) return;
    setDeletingDocId(null);
    setError(null);
    try {
      await api.deleteDocument(projectId, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
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
        <h2>{t("kb.title")}</h2>
        <span className="spacer" />
        <button className={`btn${tab === "documents" ? " primary" : ""}`} type="button" onClick={() => setTab("documents")}>
          {t("kb.tab.documents")}
        </button>
        <button className={`btn${tab === "faq" ? " primary" : ""}`} type="button" onClick={() => setTab("faq")}>
          {t("kb.tab.faq")}
        </button>
      </div>

      <ErrorText text={error} />

      {tab === "documents" && (
        <>
          <div
            className={`dropzone${dragOver ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <p>
              {t("kb.dropzone")}{" "}
              <button className="link-btn" type="button" onClick={() => fileInputRef.current?.click()}>
                {t("kb.browse")}
              </button>
            </p>
            <p className="muted small">{uploading ? t("kb.uploading") : t("kb.acceptedTypes")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files !== null && e.target.files.length > 0) void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <AddUrlForm projectId={projectId} onAdded={() => void loadDocuments()} onError={setError} />
          <AddTextForm projectId={projectId} onAdded={() => void loadDocuments()} onError={setError} />

          {loading && documents.length === 0 && <p className="muted pad">{t("common.loading")}</p>}
          {!loading && documents.length === 0 && <p className="muted pad">{t("kb.empty")}</p>}

          {documents.some((d) => ACTIVE_STATUSES.includes(d.status)) && (
            <p className="muted small">{t("kb.pollingNote")}</p>
          )}

          <ul className="entity-list">
            {documents.map((doc) => (
              <li key={doc.id} className="entity-card">
                <div className="entity-main">
                  <span className="entity-title">{doc.title}</span>
                  <span className="conv-mid">
                    <span className="chip">{t(`kb.source.${doc.source_type}`, { fallback: doc.source_type })}</span>
                    <span className={`chip st-doc-${doc.status}`}>
                      {t(`kb.status.${doc.status}`, { fallback: doc.status })}
                    </span>
                    {doc.error !== null && <span className="chip reason">{doc.error}</span>}
                  </span>
                </div>
                <div className="actions">
                  <button className="btn small-btn" type="button" onClick={() => void reindex(doc.id)}>
                    {t("kb.reindex")}
                  </button>
                  <button className="btn danger small-btn" type="button" onClick={() => setDeletingDocId(doc.id)}>
                    {t("common.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "faq" && (
        <FaqTab
          faqs={faqs}
          projectId={projectId}
          onChanged={() => void loadFaqs()}
          onDeleteAsk={setDeletingFaqId}
        />
      )}

      {deletingDocId !== null && (
        <ConfirmDialog
          title={t("common.delete")}
          body={t("kb.deleteConfirm")}
          onCancel={() => setDeletingDocId(null)}
          onConfirm={() => void deleteDocument(deletingDocId)}
        />
      )}
      {deletingFaqId !== null && (
        <ConfirmDialog
          title={t("common.delete")}
          body={t("kb.faqDeleteConfirm")}
          onCancel={() => setDeletingFaqId(null)}
          onConfirm={() => {
            const id = deletingFaqId;
            setDeletingFaqId(null);
            void api
              .deleteFaq(projectId, id)
              .then(() => setFaqs((prev) => prev.filter((f) => f.id !== id)))
              .catch((err: unknown) => {
                auth.onApiError(err);
                setError(describeApiError(err));
              });
          }}
        />
      )}
    </div>
  );
}

function AddUrlForm({
  projectId,
  onAdded,
  onError,
}: {
  projectId: string;
  onAdded: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useT();
  const auth = useAuth();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy || url.trim() === "") return;
    setBusy(true);
    onError(null);
    try {
      await api.addKnowledgeUrl(projectId, url.trim());
      setUrl("");
      onAdded();
    } catch (err) {
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
        void submit(e);
      }}
    >
      <Field label={t("kb.addUrl")}>
        <input
          type="url"
          value={url}
          placeholder={t("kb.urlPlaceholder")}
          maxLength={2000}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <button className="btn" type="submit" disabled={busy || url.trim() === ""}>
        {t("common.add")}
      </button>
    </form>
  );
}

function AddTextForm({
  projectId,
  onAdded,
  onError,
}: {
  projectId: string;
  onAdded: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useT();
  const auth = useAuth();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy || title.trim() === "" || text.trim() === "") return;
    setBusy(true);
    onError(null);
    try {
      await api.addKnowledgeText(projectId, title.trim(), text.trim());
      setTitle("");
      setText("");
      onAdded();
    } catch (err) {
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
        void submit(e);
      }}
    >
      <div className="form-grid">
        <Field label={t("kb.textTitle")}>
          <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <Field label={t("kb.textContent")}>
        <textarea rows={3} value={text} maxLength={1_000_000} onChange={(e) => setText(e.target.value)} />
      </Field>
      <button className="btn" type="submit" disabled={busy || title.trim() === "" || text.trim() === ""}>
        {t("common.add")}
      </button>
    </form>
  );
}

function FaqTab({
  faqs,
  projectId,
  onChanged,
  onDeleteAsk,
}: {
  faqs: FaqDto[];
  projectId: string;
  onChanged: () => void;
  onDeleteAsk: (id: string) => void;
}) {
  const { t } = useT();
  const auth = useAuth();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  // Ошибки CRUD раньше глотались (только 401-логаут) — показываем как остальные
  // формы страницы (аудит IR-059)
  const [error, setError] = useState("");

  const fail = (err: unknown): void => {
    auth.onApiError(err);
    setError(describeApiError(err));
  };

  const add = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy || question.trim() === "" || answer.trim() === "") return;
    setBusy(true);
    setError("");
    try {
      await api.addFaq(projectId, question.trim(), answer.trim());
      setQuestion("");
      setAnswer("");
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (faq: FaqDto): Promise<void> => {
    try {
      await api.updateFaq(projectId, faq.id, {
        question: editQuestion.trim(),
        answer: editAnswer.trim(),
      });
      setEditingId(null);
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  const toggle = async (faq: FaqDto): Promise<void> => {
    try {
      await api.updateFaq(projectId, faq.id, { enabled: !faq.enabled });
      onChanged();
    } catch (err) {
      fail(err);
    }
  };

  return (
    <>
      <form
        className="inline-form"
        onSubmit={(e) => {
          void add(e);
        }}
      >
        <h3>{t("kb.faqAdd")}</h3>
        <Field label={t("kb.faqQuestion")}>
          <input value={question} maxLength={2000} onChange={(e) => setQuestion(e.target.value)} />
        </Field>
        <Field label={t("kb.faqAnswer")}>
          <textarea rows={2} value={answer} maxLength={8000} onChange={(e) => setAnswer(e.target.value)} />
        </Field>
        <button className="btn primary" type="submit" disabled={busy || question.trim() === "" || answer.trim() === ""}>
          {t("kb.faqAdd")}
        </button>
        {error !== "" && <p className="error-text">{error}</p>}
      </form>

      {faqs.length === 0 && <p className="muted pad">{t("kb.faqEmpty")}</p>}
      <ul className="entity-list">
        {faqs.map((faq) => (
          <li key={faq.id} className="entity-card faq-card">
            {editingId === faq.id ? (
              <div className="entity-main">
                <Field label={t("kb.faqQuestion")}>
                  <input value={editQuestion} maxLength={2000} onChange={(e) => setEditQuestion(e.target.value)} />
                </Field>
                <Field label={t("kb.faqAnswer")}>
                  <textarea rows={2} value={editAnswer} maxLength={8000} onChange={(e) => setEditAnswer(e.target.value)} />
                </Field>
                <div className="actions">
                  <button className="btn primary small-btn" type="button" onClick={() => void saveEdit(faq)}>
                    {t("kb.faqSave")}
                  </button>
                  <button className="btn small-btn" type="button" onClick={() => setEditingId(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="entity-main">
                  <span className="entity-title">{faq.question}</span>
                  <span className="muted small">{faq.answer}</span>
                </div>
                <div className="actions">
                  <label className="note-toggle">
                    <input type="checkbox" checked={faq.enabled} onChange={() => void toggle(faq)} />
                    {t("kb.faqEnabled")}
                  </label>
                  <button
                    className="btn small-btn"
                    type="button"
                    onClick={() => {
                      setEditingId(faq.id);
                      setEditQuestion(faq.question);
                      setEditAnswer(faq.answer);
                    }}
                  >
                    {t("common.edit")}
                  </button>
                  <button className="btn danger small-btn" type="button" onClick={() => onDeleteAsk(faq.id)}>
                    {t("common.delete")}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
