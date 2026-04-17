import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface ToastProps {
  message: string;
  visible: boolean;
  onDone: () => void;
  duration?: number;
  tone?: "success" | "error" | "info";
}

export default function Toast({
  message,
  visible,
  onDone,
  duration = 2000,
  tone = "success",
}: ToastProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"enter" | "exit" | "hidden">("hidden");
  const [paused, setPaused] = useState(false);
  const onDoneRef = useRef(onDone);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onDoneRef.current = onDone;

  const clearTimers = useCallback(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      clearTimers();
      setPhase("hidden");
      return;
    }

    if (phase === "exit") {
      return;
    }

    setPhase("enter");
    if (paused) return;

    clearTimers();
    autoTimerRef.current = setTimeout(() => {
      setPhase("exit");
      fadeTimerRef.current = setTimeout(() => onDoneRef.current(), 200);
    }, duration);
    return clearTimers;
  }, [visible, duration, paused, phase, clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  if (phase === "hidden") return null;

  const role = tone === "error" ? "alert" : "status";
  const live = tone === "error" ? "assertive" : "polite";

  const dismiss = () => {
    if (phase === "exit") return;
    clearTimers();
    setPhase("exit");
    fadeTimerRef.current = setTimeout(() => onDoneRef.current(), 180);
  };

  return (
    <div
      role={role}
      aria-live={live}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-(--border) bg-(--bg-elevated) px-4 py-2.5 text-xs font-medium shadow-sm ${
        phase === "enter" ? "toast-enter" : "toast-exit"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className="dot"
          data-tone={tone === "error" ? "danger" : tone === "info" ? "info" : "success"}
        />
        <span>{message}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("actions.close")}
          className="ml-1 grid h-5 w-5 shrink-0 place-items-center rounded-md text-(--text-muted) transition-colors hover:bg-(--bg-muted) hover:text-(--text-primary) focus-visible:outline-2 focus-visible:outline-(--accent)"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
          </svg>
        </button>
      </span>
    </div>
  );
}
