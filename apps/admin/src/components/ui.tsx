/**
 * Минимальные общие UI-компоненты Ф5 (без UI-библиотек): модалка, поле формы,
 * пустое состояние, подтверждение действия, копирование в буфер.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint !== undefined && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function ErrorText({ text }: { text: string | null }) {
  if (text === null) return null;
  return <p className="error-text">{text}</p>;
}

// EmptyState удалён (аудит IR-059): ни один экран его не использовал

/**
 * Модалка на портале в body: клик по подложке и Esc закрывают.
 * Никакого dangerouslySetInnerHTML — только экранированные React-узлы.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        onClose();
      }}
      role="presentation"
    >
      <div
        className={`modal${wide === true ? " modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button
            className="btn"
            onClick={onClose}
            aria-label="close"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="confirm-body">{body}</p>
      <div className="modal-actions">
        <button className="btn" type="button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button className="btn danger" type="button" onClick={onConfirm}>
          {t("common.yes")}
        </button>
      </div>
    </Modal>
  );
}

/** Копирование в буфер; false — нужен fallback с выделением текста. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API недоступен (не https/нет разрешения) — вызывающий код
    // выделяет текст, чтобы пользователь скопировал вручную (Ctrl+C).
    return false;
  }
}

/** Выделение содержимого элемента как fallback копирования. */
export function selectElementText(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  if (selection !== null) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  const copy = async (): Promise<void> => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      const el = preRef.current;
      if (el !== null) selectElementText(el);
      return;
    }
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <span className="copy-group">
      {/* Сниппет рендерится текстом внутри pre — безопасно по XSS */}
      <pre ref={preRef} className="code-block">
        {text}
      </pre>
      <button className="btn primary" type="button" onClick={() => void copy()}>
        {copied ? t("common.copied") : t("common.copy")}
      </button>
    </span>
  );
}
