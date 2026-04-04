import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  visible: boolean;
  onDone: () => void;
  duration?: number;
}

export default function Toast({ message, visible, onDone, duration = 2000 }: ToastProps) {
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

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed left-1/2 top-5 z-50 -translate-x-1/2 rounded-full border border-black/5 bg-white/90 px-5 py-2.5 text-sm font-semibold shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/90 ${
        phase === "enter" ? "toast-enter" : "toast-exit"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="text-success">✓</span>
        {message}
      </span>
    </div>
  );
}
