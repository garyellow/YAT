import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { RecordingStatus } from "./stores/recordingStore";

const statusConfig: Record<
  RecordingStatus,
  { bg: string; pulse: boolean; label: string }
> = {
  idle: { bg: "bg-gray-500", pulse: false, label: "" },
  recording: { bg: "bg-red-500", pulse: true, label: "🎙" },
  transcribing: { bg: "bg-purple-500", pulse: true, label: "⏳" },
  polishing: { bg: "bg-blue-500", pulse: true, label: "✨" },
  done: { bg: "bg-emerald-500", pulse: false, label: "✓" },
  error: { bg: "bg-gray-400", pulse: false, label: "✗" },
};

export default function CapsuleApp() {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [, setText] = useState("");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const unlisten = listen<{ status: RecordingStatus; text?: string }>(
      "pipeline-status",
      (e) => {
        setStatus(e.payload.status);
        if (e.payload.text) setText(e.payload.text);
      }
    );
    const unlisten2 = listen<string>("capsule-status", (e) => {
      setStatus(e.payload as RecordingStatus);
    });
    return () => {
      unlisten.then((f) => f());
      unlisten2.then((f) => f());
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
    <div className="flex items-center justify-center w-full h-full no-select" data-tauri-drag-region>
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg text-white text-sm font-medium ${cfg.bg} ${cfg.pulse ? "animate-pulse" : ""}`}
      >
        <span className="text-base">{cfg.label}</span>
        {status === "recording" && (
          <>
            <span className="tabular-nums text-xs opacity-80">
              {formatTime(elapsed)}
            </span>
            <button
              onClick={() => invoke("cancel_recording")}
              className="ml-1 text-white/80 hover:text-white text-xs underline"
            >
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  );
}
