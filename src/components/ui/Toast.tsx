import { useEffect, useState } from "react";

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
  const [phase, setPhase] = useState<"enter" | "exit" | "hidden">("hidden");

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    if (visible) {
      setPhase("enter");
      const timer = setTimeout(() => {
        setPhase("exit");
        fadeTimer = setTimeout(onDone, 200);
      }, duration);
      return () => {
        clearTimeout(timer);
        if (fadeTimer) clearTimeout(fadeTimer);
      };
    } else {
      setPhase("hidden");
    }
  }, [visible, duration, onDone]);

  if (phase === "hidden") return null;

  const role = tone === "error" ? "alert" : "status";
  const live = tone === "error" ? "assertive" : "polite";

  return (
    <div
      role={role}
      aria-live={live}
      className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 text-xs font-medium shadow-lg ${
        phase === "enter" ? "toast-enter" : "toast-exit"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className="dot"
          data-tone={tone === "error" ? "danger" : tone === "info" ? "info" : "success"}
        />
        {message}
      </span>
    </div>
  );
}
