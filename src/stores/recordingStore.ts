import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
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
  | "clipboardFallback";

interface PipelinePayload {
  status: RecordingStatus;
  text?: string;
  error?: string;
}

interface RecordingState {
  status: RecordingStatus;
  lastText: string | null;
  lastError: string | null;
  init: () => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  status: "idle",
  lastText: null,
  lastError: null,

  init: () => {
    if (initialized) return;
    initialized = true;

    listen<PipelinePayload>("pipeline-status", (event) => {
      const { status, text, error } = event.payload;

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
        return;
      }

      set({
        status,
        lastText: text ?? null,
        lastError: error ?? null,
      });
    });
  },
}));
