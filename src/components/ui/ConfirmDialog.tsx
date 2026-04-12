import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: "danger" | "default";
}

export default function ConfirmDialog({ open, title, message, onConfirm, onCancel, tone = "default" }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  const resolvedTitle = title ?? t("actions.confirm");

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }

      if (e.key !== "Tab") return;

      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="dialog-backdrop absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        className="dialog-panel relative w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId} className="text-sm font-semibold text-[var(--text)]">
          {resolvedTitle}
        </h2>
        <p id={messageId} className="mt-2 text-sm leading-relaxed text-[var(--text)]">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost text-xs"
            onClick={onCancel}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`btn text-xs ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            {t("actions.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
