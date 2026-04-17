import { useEffect, useId, useRef, useState } from "react";
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
  const previousFocusRef = useRef<Element | null>(null);
  const titleId = useId();
  const messageId = useId();
  const resolvedTitle = title ?? t("actions.confirm");

  // Delay unmount to allow exit animation to play
  const [mounted, setMounted] = useState(false);
  const exiting = mounted && !open;

  useEffect(() => {
    if (open) {
      setMounted(true);
    } else if (mounted) {
      const id = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(id);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (open && mounted) {
      previousFocusRef.current = document.activeElement;
      cancelRef.current?.focus();
    } else if (!open && previousFocusRef.current) {
      const el = previousFocusRef.current;
      previousFocusRef.current = null;
      if (el instanceof HTMLElement) el.focus();
    }
  }, [open, mounted]);

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

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center">
      <div
        className={`absolute inset-0 bg-black/40 ${exiting ? "dialog-backdrop-exit" : "dialog-backdrop"}`}
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        className={`relative w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-(--border) bg-(--bg-elevated) p-5 shadow-md ${exiting ? "dialog-panel-exit" : "dialog-panel"}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId} className="text-sm font-semibold text-(--text)">
          {resolvedTitle}
        </h2>
        <p id={messageId} className="mt-2 text-sm leading-relaxed text-(--text)">
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
