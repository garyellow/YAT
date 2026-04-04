import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface SttConfig {
  base_url: string;
  api_key: string;
  model: string;
  language: string | null;
}

export interface LlmConfig {
  enabled: boolean;
  base_url: string;
  api_key: string;
  model: string;
}

export interface HotkeyConfig {
  hotkey_type: "single" | "double_tap" | "combo" | "hold";
  key: string;
  modifier: string | null;
  double_tap_interval_ms: number;
}

export interface GeneralConfig {
  hotkey: HotkeyConfig;
  theme: string;
  auto_start: boolean;
  max_recording_seconds: number;
  output_mode: "auto_paste" | "clipboard_only";
  clipboard_behavior: "always" | "only_on_paste_fail";
  language: string;
  timeout_ms: number;
  max_retries: number;
  sound_effects: boolean;
  auto_mute: boolean;
  microphone_device: string | null;
}

export interface VocabularyEntry {
  wrong: string;
  correct: string;
}

export interface PromptConfig {
  system_prompt: string;
  vocabulary: VocabularyEntry[];
}

export interface HistoryConfig {
  retention_hours: number;
  context_window_minutes: number;
}

export interface AppSettings {
  stt: SttConfig;
  llm: LlmConfig;
  general: GeneralConfig;
  prompt: PromptConfig;
  history: HistoryConfig;
}

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  saved: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  saved: false,

  loadSettings: async () => {
    set({ loading: true });
    const settings = await invoke<AppSettings>("get_settings");
    set({ settings, loading: false });
  },

  saveSettings: async (settings: AppSettings) => {
    await invoke("save_settings", { settings });
    set({ settings, saved: true });
    setTimeout(() => set({ saved: false }), 2000);
  },

  updateSettings: (partial) => {
    const current = get().settings;
    if (current) {
      set({ settings: { ...current, ...partial }, saved: false });
    }
  },
}));
