import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { RecordingStatus } from "./stores/recordingStore";
import type { AppSettings } from "./stores/settingsStore";

const statusConfig: Record<
  RecordingStatus,
  { shell: string; dot: string; pulse: boolean }
> = {
  idle: {
    shell: "border-white/10 bg-slate-900/60",
    dot: "bg-slate-300",
    pulse: false,
  },
  recording: {
    shell: "border-red-300/30 bg-red-500/85",
    dot: "bg-white",
    pulse: true,
  },
  transcribing: {
    shell: "border-violet-300/30 bg-violet-500/85",
    dot: "bg-white",
    pulse: true,
  },
  polishing: {
    shell: "border-sky-300/30 bg-sky-500/85",
    dot: "bg-white",
    pulse: true,
  },
  done: {
    shell: "border-emerald-300/30 bg-emerald-500/85",
    dot: "bg-white",
    pulse: false,
  },
  error: {
    shell: "border-rose-300/30 bg-rose-500/85",
    dot: "bg-white",
    pulse: false,
  },
};

export default function CapsuleApp() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [micLevel, setMicLevel] = useState(0);

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then((appSettings) => {
        if (appSettings.general.language) {
          void i18n.changeLanguage(appSettings.general.language);
        }
      })
      .catch(() => {});
  }, [i18n]);

  useEffect(() => {
    let mounted = true;
    const unlisten = listen<{ status: RecordingStatus; text?: string }>(
      "pipeline-status",
      (e) => {
        if (mounted) setStatus(e.payload.status);
      }
    );
    const unlisten2 = listen<string>("capsule-status", (e) => {
      if (mounted) setStatus(e.payload as RecordingStatus);
    });
    const unlisten3 = listen<number>("mic-level", (e) => {
      if (mounted) setMicLevel(e.payload);
    });
    return () => {
      mounted = false;
      unlisten.then((f) => f());
      unlisten2.then((f) => f());
      unlisten3.then((f) => f());
    };
  }, []);

  // Recording timer
  useEffect(() => {
    if (status === "recording") {
      setElapsed(0);
      const id = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(id);
    }
  }, [status]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const cfg = statusConfig[status] ?? statusConfig.idle;
  if (status === "idle") return null;

  return (
    <div className="flex h-full w-full items-center justify-center no-select" data-tauri-drag-region>
      <div
        className={`flex min-w-[220px] items-center gap-3 rounded-[22px] border px-4 py-3 text-white shadow-2xl backdrop-blur-xl ${cfg.shell}`}
        aria-live="polite"
      >
        <span
          className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot} ${cfg.pulse ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold tracking-tight">
              {t(`status.${status}`)}
            </p>
            {status === "recording" ? (
              <span className="tabular-nums text-xs text-white/75">
                {formatTime(elapsed)}
              </span>
            ) : null}
          </div>

          {status === "recording" ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-100"
                style={{ width: `${Math.min(micLevel * 420, 100)}%` }}
              />
            </div>
          ) : null}
        </div>

        {status === "recording" && (
          <button
            onClick={() => invoke("cancel_recording")}
            className="rounded-full border border-white/25 px-3 py-1 text-xs font-semibold text-white/90 transition-colors hover:bg-white/10"
            aria-label={t("actions.cancel")}
          >
            {t("actions.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
