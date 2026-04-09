import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { RecordingStatus } from "./stores/recordingStore";
import type { AppSettings } from "./stores/settingsStore";
import { isTauriRuntime } from "./lib/tauriRuntime";

const statusConfig: Record<
  RecordingStatus,
  { shell: string; dot: string; pulse: boolean }
> = {
  idle: {
    shell: "bg-neutral-900/90 border-white/10",
    dot: "bg-neutral-400",
    pulse: false,
  },
  recording: {
    shell: "bg-neutral-900/92 border-white/15",
    dot: "bg-white",
    pulse: true,
  },
  transcribing: {
    shell: "bg-neutral-900/90 border-white/12",
    dot: "bg-white/80",
    pulse: true,
  },
  polishing: {
    shell: "bg-neutral-900/90 border-white/12",
    dot: "bg-white/80",
    pulse: true,
  },
  done: {
    shell: "bg-neutral-900/90 border-white/10",
    dot: "bg-emerald-400",
    pulse: false,
  },
  clipboardFallback: {
    shell: "bg-neutral-900/90 border-white/10",
    dot: "bg-amber-400",
    pulse: false,
  },
  busy: {
    shell: "bg-neutral-900/90 border-white/12",
    dot: "bg-white/80",
    pulse: true,
  },
  error: {
    shell: "bg-neutral-900/90 border-white/10",
    dot: "bg-red-400",
    pulse: false,
  },
};

/**
 * Convert raw RMS amplitude (0–1) to a display percentage for the mic bar.
 *
 * Design goals:
 *  - Ambient room noise (RMS ≤ 0.01) → 0 % so the bar stays still when silent.
 *  - Soft speech (~0.02)              → ~15 % — just enough to notice.
 *  - Normal speech (~0.05–0.10)       → 35–50 % — clear visual feedback.
 *  - Loud speech (≥ 0.20)            → 65 %+   — prominent but not pinned.
 *
 * The conversion uses dB above the noise floor, linearly mapped to 0–100 %:
 *   dB = 20 · log₁₀(rms / NOISE_FLOOR)
 * Full-scale (rms = 1) is 40 dB above a 0.01 floor → 40 × 2.5 = 100 %.
 */
function micLevelToBar(rms: number): number {
  const NOISE_FLOOR = 0.01;
  if (rms < NOISE_FLOOR) return 0;
  const db = 20 * Math.log10(rms / NOISE_FLOOR);
  return Math.min(db * 2.5, 100);
}

export default function CapsuleApp() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [platformOs, setPlatformOs] = useState<string>("");

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    invoke<AppSettings>("get_settings")
      .then((appSettings) => {
        if (appSettings.general.language) {
          void i18n.changeLanguage(appSettings.general.language);
        }
      })
      .catch(() => {});

    invoke<{ os: string }>("get_platform_context")
      .then((platform) => setPlatformOs(platform.os))
      .catch(() => {});
  }, [i18n]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let mounted = true;
    const unlisten = listen<{ status: RecordingStatus; text?: string; error?: string }>(
      "pipeline-status",
      (e) => {
        if (mounted && e.payload.status !== "busy") {
          setStatus(e.payload.status);
          if (e.payload.status === "error") {
            setErrorMsg(e.payload.error ?? e.payload.text ?? "");
          } else {
            setErrorMsg("");
          }
        }
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
  const detailMessage =
    status === "error"
      ? errorMsg || t("capsule.errorUnknown")
      : status === "clipboardFallback"
        ? platformOs === "windows"
          ? t("capsule.clipboardFallbackHintWindows")
          : platformOs === "macos"
            ? t("capsule.clipboardFallbackHintMacos")
            : t("capsule.clipboardFallbackHint")
        : "";

  const [visible, setVisible] = useState(false);
  const prevStatus = useRef<RecordingStatus>("idle");

  useEffect(() => {
    if (status !== "idle") {
      setVisible(true);
    } else if (prevStatus.current !== "idle") {
      // Leaving non-idle -> play exit animation
      const timer = setTimeout(() => setVisible(false), 250);
      return () => clearTimeout(timer);
    }
    prevStatus.current = status;
  }, [status]);

  if (!visible && status === "idle") return null;

  const isExiting = status === "idle" && visible;

  return (
    <div
      className="flex h-full w-full items-end justify-center pb-4 no-select"
      data-tauri-drag-region
    >
      <div
        className={`flex min-w-[280px] max-w-[420px] items-start gap-3 rounded-2xl border px-4 py-3.5 text-white shadow-2xl backdrop-blur-xl transition-all duration-200 ${cfg.shell} ${
          isExiting ? "animate-capsule-exit" : "animate-capsule-enter"
        }`}
        aria-live={status === "error" ? "assertive" : "polite"}
        role={status === "error" ? "alert" : "status"}
      >
        <span
          className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${cfg.dot} ${cfg.pulse ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold tracking-tight">
              {t(`status.${status === "idle" ? prevStatus.current : status}`)}
            </p>
            {status === "recording" ? (
              <span className="tabular-nums text-xs text-white/75">
                {formatTime(elapsed)}
              </span>
            ) : null}
          </div>

          {status === "recording" ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-100"
                style={{ width: `${micLevelToBar(micLevel)}%` }}
              />
            </div>
          ) : null}

          {detailMessage ? (
            <p
              className={`mt-1 text-[11px] leading-4 break-words ${
                  status === "error" ? "text-red-200/95" : "text-white/70"
              }`}
              title={detailMessage}
            >
              {detailMessage}
            </p>
          ) : null}
        </div>

        {status === "recording" && (
          <span
            className="rounded-lg border border-white/20 px-2.5 py-1 text-[11px] font-medium text-white/50"
            aria-label={t("capsule.escHint")}
          >
            Esc
          </span>
        )}
      </div>
    </div>
  );
}
