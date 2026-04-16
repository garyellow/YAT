import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { sounds } from "../lib/sounds";
import { useSettingsStore } from "./settingsStore";

let initialized = false;

export type RecordingStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "polishing"
  | "done"
  | "error"
  | "busy"
  | "clipboardFallback"
  | "autoPastePaused"
  | "dismissed"
  | "noSpeech";

interface PipelinePayload {
  status: RecordingStatus;
  text?: string;
  error?: string;
  generation?: number;
}

interface RecordingState {
  status: RecordingStatus;
  lastText: string | null;
  lastError: string | null;
  latestGeneration: number;
  /** Consecutive paste‐failed‐clipboard‐fallback count for this session. */
  pasteFailCount: number;
  init: () => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  status: "idle",
  lastText: null,
  lastError: null,
  latestGeneration: 0,
  pasteFailCount: 0,

  init: () => {
    if (initialized) return;
    initialized = true;

    if (!isTauriRuntime()) {
      return;
    }

    listen<PipelinePayload>("pipeline-status", (event) => {
      const { status, text, error, generation } = event.payload;

      const currentGeneration = get().latestGeneration;
      if (typeof generation === "number" && generation < currentGeneration) {
        return;
      }
      const nextGeneration =
        typeof generation === "number" ? generation : currentGeneration;

      // Play sound effects if enabled
      const soundEnabled =
        useSettingsStore.getState().settings?.general.sound_effects ?? true;
      if (soundEnabled) {
        switch (status) {
          case "recording":
            sounds.startRecording();
            break;
          case "transcribing":
            sounds.stopRecording();
            break;
          case "done":
            sounds.done();
            break;
          case "clipboardFallback":
          case "autoPastePaused":
            sounds.done();
            break;
          case "error":
            sounds.error();
            break;
          case "busy":
            sounds.busy();
            break;
        }
      }

      // "busy" is only a transient feedback cue when the user tries to
      // trigger recording during an active pipeline. Keep the visible status
      // aligned with the real pipeline stage (recording/transcribing/polishing)
      // and let the sound effect carry the feedback.
      if (status === "busy") {
        set({ latestGeneration: nextGeneration });
        return;
      }

      // "dismissed" means the recording was too short and was auto-skipped.
      // "noSpeech" means STT returned an empty transcription.
      // Update status for capsule display but don't touch lastText/lastError.
      if (status === "dismissed" || status === "noSpeech") {
        set({ status, latestGeneration: nextGeneration });
        return;
      }

      set({
        status,
        lastText: text ?? null,
        lastError: error ?? null,
        latestGeneration: nextGeneration,
        pasteFailCount:
          status === "clipboardFallback" || status === "autoPastePaused"
            ? get().pasteFailCount + 1
            : status === "done"
              ? 0
              : get().pasteFailCount,
      });
    });
  },
}));
