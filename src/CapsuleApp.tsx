import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { RecordingStatus } from "./stores/recordingStore";
import type { AppSettings } from "./stores/settingsStore";
import { isTauriRuntime } from "./lib/tauriRuntime";
import { sounds } from "./lib/sounds";

/* ─── Status → visual config ─── */

type StatusStyle = { dot: string; pulse: boolean };

const statusStyles: Record<RecordingStatus, StatusStyle> = {
  idle:              { dot: "bg-slate-400",    pulse: false },
  recording:         { dot: "bg-rose-500",     pulse: true  },
  transcribing:      { dot: "bg-indigo-400",   pulse: true  },
  polishing:         { dot: "bg-violet-400",   pulse: true  },
  done:              { dot: "bg-emerald-400",  pulse: false },
  clipboardFallback: { dot: "bg-amber-400",    pulse: false },
  autoPastePaused:   { dot: "bg-amber-300",    pulse: false },
  busy:              { dot: "bg-indigo-300",   pulse: true  },
  error:             { dot: "bg-red-400",      pulse: false },
  dismissed:         { dot: "bg-slate-500",    pulse: false },
  noSpeech:          { dot: "bg-amber-500",    pulse: false },
};

type CapsulePlatform = "windows" | "macos" | "linux" | "unknown";

interface CapsulePreviewState {
  status: RecordingStatus;
  elapsed: number;
  micLevel: number;
  maxSeconds: number;
  message: string;
  language: string | null;
  platform: CapsulePlatform;
}

/* ─── Mic level → display bar ─── */

function micLevelToBar(rms: number): number {
  const NOISE_FLOOR = 0.01;
  if (rms < NOISE_FLOOR) return 0;
  const db = 20 * Math.log10(rms / NOISE_FLOOR);
  return Math.min(db * 2.5, 100);
}

function getPlatformOs(): CapsulePlatform {
  if (typeof navigator === "undefined") return "unknown";
  const platform = (navigator as any).userAgentData?.platform ?? navigator.platform;
  if (/win/i.test(platform)) return "windows";
  if (/mac/i.test(platform)) return "macos";
  if (/linux/i.test(platform)) return "linux";
  return "unknown";
}

function parsePreviewStatus(value: string | null): RecordingStatus | null {
  switch (value) {
    case "idle":
    case "recording":
    case "transcribing":
    case "polishing":
    case "done":
    case "clipboardFallback":
    case "autoPastePaused":
    case "busy":
    case "error":
    case "dismissed":
    case "noSpeech":
      return value;
    default:
      return null;
  }
}

function parsePositiveNumber(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePreviewPlatform(value: string | null): CapsulePlatform {
  switch (value) {
    case "windows":
    case "macos":
    case "linux":
      return value;
    default:
      return getPlatformOs();
  }
}

function getCapsulePreviewState(): CapsulePreviewState | null {
  if (typeof window === "undefined" || isTauriRuntime()) return null;

  const params = new URLSearchParams(window.location.search);
  const status = parsePreviewStatus(params.get("preview"));
  if (!status) return null;

  return {
    status,
    elapsed: parsePositiveNumber(params.get("elapsed"), 18),
    micLevel: parsePositiveNumber(params.get("mic"), 0.18),
    maxSeconds: Math.max(1, parsePositiveNumber(params.get("max"), 180)),
    message: params.get("message") ?? "",
    language: params.get("lang"),
    platform: parsePreviewPlatform(params.get("platform")),
  };
}

/* ─── Component ─── */

export default function CapsuleApp() {
  const { t, i18n } = useTranslation();
  const preview = useMemo(() => getCapsulePreviewState(), []);
  const platformOs = preview?.platform ?? getPlatformOs();

  const [status, setStatus] = useState<RecordingStatus>(preview?.status ?? "idle");
  const [elapsed, setElapsed] = useState(preview?.elapsed ?? 0);
  const [micLevel, setMicLevel] = useState(preview?.micLevel ?? 0);
  const [errorMsg, setErrorMsg] = useState(preview?.message ?? "");
  const [maxSeconds, setMaxSeconds] = useState(preview?.maxSeconds ?? 180);
  const [soundEffects, setSoundEffects] = useState(!preview);
  const countdownFired = useRef(false);
  const latestGenerationRef = useRef(0);

  const refreshCapsuleSettings = useCallback(() => {
    if (!isTauriRuntime()) return;

    invoke<AppSettings>("get_settings")
      .then((s) => {
        if (s.general.language) void i18n.changeLanguage(s.general.language);
        setMaxSeconds(s.general.max_recording_seconds);
        setSoundEffects(s.general.sound_effects);
      })
      .catch(() => {});
  }, [i18n]);

  /* ── Bootstrap ── */

  useEffect(() => {
    if (preview?.language) {
      void i18n.changeLanguage(preview.language);
    }
  }, [i18n, preview]);

  useEffect(() => {
    if (preview) return;
    refreshCapsuleSettings();
  }, [preview, refreshCapsuleSettings]);

  // Refresh dynamic capsule-relevant settings when a new recording starts.
  // This keeps countdown/sound behavior consistent even if user changed
  // settings while the app was already running.
  useEffect(() => {
    if (preview) return;
    if (status === "recording") {
      refreshCapsuleSettings();
    }
  }, [preview, status, refreshCapsuleSettings]);

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage || i18n.language || "zh-TW";
  }, [i18n.language, i18n.resolvedLanguage]);

  /* ── Event listeners ── */

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let mounted = true;

    const off1 = listen<{
      status: RecordingStatus;
      text?: string;
      error?: string;
      generation?: number;
    }>("pipeline-status", (e) => {
      if (!mounted) return;

      if (typeof e.payload.generation === "number") {
        if (e.payload.generation < latestGenerationRef.current) {
          return;
        }
        latestGenerationRef.current = e.payload.generation;
      }

      if (e.payload.status === "busy") return;

      setStatus(e.payload.status);
      setErrorMsg(
        e.payload.status === "error"
          ? e.payload.error ?? e.payload.text ?? ""
          : "",
      );
    });

    const off2 = listen<number>("mic-level", (e) => {
      if (mounted) setMicLevel(e.payload);
    });

    return () => {
      mounted = false;
      off1.then((f) => f());
      off2.then((f) => f());
    };
  }, []);

  /* ── Recording timer ── */

  useEffect(() => {
    if (preview) return;
    if (status !== "recording") return;
    setElapsed(0);
    countdownFired.current = false;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [preview, status]);

  /* ── Countdown sound cue ── */

  useEffect(() => {
    if (preview) return;
    if (
      status === "recording" &&
      soundEffects &&
      !countdownFired.current &&
      maxSeconds - elapsed === 60
    ) {
      countdownFired.current = true;
      sounds.countdownSwitch();
    }
  }, [elapsed, maxSeconds, preview, soundEffects, status]);

  /* ── Visibility lifecycle ── */

  const [visible, setVisible] = useState(false);
  const prevStatus = useRef<RecordingStatus>("idle");

  useEffect(() => {
    if (status !== "idle") {
      setVisible(true);
    } else if (prevStatus.current !== "idle") {
      const id = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(id);
    }
    prevStatus.current = status;
  }, [status]);

  /* ── Derived state ── */

  const remaining = maxSeconds - elapsed;
  const isCountdown = status === "recording" && remaining <= 60 && remaining > 0;

  const formatTime = useCallback(
    (s: number) =>
      `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`,
    [],
  );

  const cfg = statusStyles[status] ?? statusStyles.idle;
  const displayStatus = status === "idle" ? prevStatus.current : status;

  const detailMessage =
    status === "error"
      ? errorMsg || t("capsule.errorUnknown")
      : status === "clipboardFallback"
        ? platformOs === "windows"
          ? t("capsule.clipboardFallbackHintWindows")
          : platformOs === "macos"
            ? t("capsule.clipboardFallbackHintMacos")
            : t("capsule.clipboardFallbackHint")
        : status === "autoPastePaused"
          ? platformOs === "windows"
            ? t("capsule.autoPastePausedHintWindows")
            : platformOs === "macos"
              ? t("capsule.autoPastePausedHintMacos")
              : t("capsule.autoPastePausedHint")
        : status === "dismissed"
          ? t("capsule.dismissedHint")
          : status === "noSpeech"
            ? t("capsule.noSpeechHint")
            : "";

  /* ── Gate render ── */

  if (!visible && status === "idle") return null;

  const isExiting = status === "idle" && visible;
  const showMicBar = status === "recording";
  const showDetail = !!detailMessage;

  /* ── Dynamic resize ── */

  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauriRuntime() || !visible) return;
    // Wait a frame for layout to finalize, then measure actual content height
    const raf = requestAnimationFrame(() => {
      const el = viewportRef.current;
      if (!el) return;
      const height = Math.ceil(el.scrollHeight);
      invoke("resize_capsule", { height }).catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, [showDetail, visible, status, detailMessage]);

  return (
    <div className="capsule-viewport" ref={viewportRef}>
      {/* Main pill */}
      <div
        className={`capsule-pill ${isExiting ? "capsule-exit" : "capsule-enter"}`}
        aria-live={status === "error" ? "assertive" : "polite"}
        role={status === "error" ? "alert" : "status"}
      >
        <span
          className={`capsule-dot ${cfg.dot} ${cfg.pulse ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />

        <span className="capsule-label">{t(`status.${displayStatus}`)}</span>

        {status === "recording" && (
          <span className={`capsule-timer ${isCountdown ? "capsule-timer--warn" : ""}`}>
            {isCountdown ? `⏱\u2009${formatTime(remaining)}` : formatTime(elapsed)}
          </span>
        )}

        {showMicBar && (
          <div className="capsule-mic">
            <div
              className="capsule-mic-fill"
              style={{ width: `${micLevelToBar(micLevel)}%` }}
            />
          </div>
        )}

        {status === "recording" && (
          <kbd className="capsule-esc" aria-label={t("capsule.escHint")}>
            {t("capsule.escKey")}
          </kbd>
        )}
      </div>

      {/* Detail text for error / clipboard fallback / dismissed / noSpeech */}
      {showDetail && (
        <p
          className={`capsule-detail ${status === "error" ? "capsule-detail--error" : ""}`}
          title={detailMessage}
        >
          {detailMessage}
        </p>
      )}
    </div>
  );
}
