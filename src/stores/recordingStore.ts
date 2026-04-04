import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { sounds } from "../lib/sounds";
import { useSettingsStore } from "./settingsStore";

export type RecordingStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "polishing"
  | "done"
  | "error";

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
          case "error":
            sounds.error();
            break;
        }
      }

      set({
        status,
        lastText: text ?? null,
        lastError: error ?? null,
      });
    });
  },
}));
