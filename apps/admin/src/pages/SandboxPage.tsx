/**
 * /projects/:id/sandbox — тестовый диалог (docs/22 §5): чат-окно как у виджета
 * (пузыри, цитаты-чипы, бейдж confidence, плашка fallback).
 * POST /projects/:id/sandbox/messages {text} → {answer}. История — в памяти.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { describeApiError } from "../format";
import { useT } from "../i18n";
import type { SandboxAnswer } from "../api/types";
import { api, useAuth } from "../state/auth";
import { useProjectRouteId } from "../components/Layout";
import { ErrorText } from "../components/ui";

interface SandboxTurn {
  id: number;
  role: "visitor" | "assistant";
  text: string;
  answer?: SandboxAnswer;
}

export function SandboxPage() {
  const { t } = useT();
  const auth = useAuth();
  const projectId = useProjectRouteId();

  const [turns, setTurns] = useState<SandboxTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Автопрокрутка вниз при новой реплике.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const send = async (): Promise<void> => {
    if (projectId === null || sending) return;
    const text = draft.trim();
    if (text === "") return;
    seqRef.current += 1;
    const visitorId = seqRef.current;
    setTurns((prev) => [...prev, { id: visitorId, role: "visitor", text }]);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const res = await api.sendSandboxMessage(projectId, text);
      seqRef.current += 1;
      setTurns((prev) => [
        ...prev,
        { id: seqRef.current, role: "assistant", text: res.answer.text, answer: res.answer },
      ]);
    } catch (err) {
      auth.onApiError(err);
      if (err instanceof ApiError && err.status === 404) {
        setError(t("common.notFoundBackend"));
      } else {
        setError(describeApiError(err));
      }
      setTurns((prev) => prev.filter((turn) => turn.id !== visitorId));
    } finally {
      setSending(false);
    }
  };

  if (projectId === null)
    return <div className="page-card"><p className="muted pad">{t("project.none")}</p></div>;

  return (
    <div className="page-card sandbox-page">
      <div className="page-head">
        <h2>{t("sbx.title")}</h2>
        <span className="spacer" />
        {turns.length > 0 && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              setTurns([]);
              setError(null);
            }}
          >
            {t("sbx.clear")}
          </button>
        )}
      </div>
      <p className="muted small">{t("sbx.hint")}</p>

      <div className="sandbox-window">
        <div className="sandbox-scroll" ref={scrollRef}>
          {turns.length === 0 && !sending && <p className="muted center pad">{t("sbx.hint")}</p>}
          {turns.map((turn) =>
            turn.role === "visitor" ? (
              <div key={turn.id} className="row row-visitor">
                <span className="msg-meta">{t("sbx.you")}</span>
                <div className="bubble bubble-visitor">{turn.text}</div>
              </div>
            ) : (
              <div key={turn.id} className="row row-assistant">
                <span className="msg-meta">{t("sbx.bot")}</span>
                <div className="bubble bubble-assistant">{turn.text}</div>
                {turn.answer !== undefined && (
                  <AnswerFootnote answer={turn.answer} />
                )}
              </div>
            ),
          )}
          {sending && (
            <div className="row row-assistant">
              <div className="bubble bubble-assistant muted">{t("sbx.thinking")}</div>
            </div>
          )}
        </div>

        <ErrorText text={error} />

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={draft}
            placeholder={t("sbx.placeholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="btn primary" type="submit" disabled={sending || draft.trim() === ""}>
            {t("sbx.send")}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Цитаты-чипы + бейдж confidence + плашка fallback под ответом AI. */
function AnswerFootnote({ answer }: { answer: SandboxAnswer }) {
  const { t } = useT();
  const citations = answer.citations ?? [];
  return (
    <span className="sandbox-foot">
      {answer.fallback === true && <span className="chip reason">{t("sbx.fallbackBadge")}</span>}
      {answer.confidence !== undefined && answer.confidence !== null && (
        <span className={`chip ${answer.confidence >= 0.55 ? "" : "reason"}`}>
          {t("sbx.confidence", { params: { value: Math.round(answer.confidence * 100) } })}
        </span>
      )}
      {citations.length > 0 && (
        <span className="citations-row">
          <span className="muted small">{t("sbx.citations")}</span>
          {citations.map((c) => (
            <span key={c.chunk_id} className="chip citation" title={c.chunk_id}>
              #{c.chunk_id.slice(0, 8)} · {(c.score * 100).toFixed(0)}%
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
