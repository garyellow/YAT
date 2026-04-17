import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  cloneSettings,
  loadMockSettings,
  normalizeVocabularyEntries,
  saveMockSettings,
} from "../lib/defaultSettings";
import { validateSettings } from "../lib/settingsFormatters";
import type { HotkeyValidationCode } from "../lib/settingsFormatters";
import { isTauriRuntime } from "../lib/tauriRuntime";

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
  held_keys: string[];
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
  background_audio_mode: "off" | "duck" | "mute";
  background_audio_ducking_percent: number;
  auto_pause_media: boolean;
  microphone_device: string | null;
  close_to_tray: boolean;
  start_minimized: boolean;
}

export interface VocabularyEntry {
  text: string;
}

export interface PromptConfig {
  system_prompt: string;
  user_instructions: string;
  vocabulary: VocabularyEntry[];
  context_clipboard: boolean;
  context_selection: boolean;
  context_active_app: boolean;
  context_input_field: boolean;
  context_screenshot: boolean;
}

export interface HistoryConfig {
  retention_hours: number;
  context_window_minutes: number;
  audio_retention_hours: number;
}

export interface AppSettings {
  stt: SttConfig;
  llm: LlmConfig;
  general: GeneralConfig;
  prompt: PromptConfig;
  history: HistoryConfig;
}

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  dirty: boolean;
  saveStatus: SaveStatus;
  lastSaveError: string | null;
  validationError: HotkeyValidationCode | null;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => void;
  flushSettings: () => Promise<void>;
}

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function mergeSettings(current: AppSettings, partial: Partial<AppSettings>): AppSettings {
  return {
    ...current,
    ...partial,
    stt: partial.stt ? { ...current.stt, ...partial.stt } : current.stt,
    llm: partial.llm ? { ...current.llm, ...partial.llm } : current.llm,
    general: partial.general
      ? {
          ...current.general,
          ...partial.general,
          hotkey: partial.general.hotkey
            ? { ...current.general.hotkey, ...partial.general.hotkey }
            : current.general.hotkey,
        }
      : current.general,
    prompt: partial.prompt
      ? {
          ...current.prompt,
          ...partial.prompt,
          vocabulary: partial.prompt.vocabulary ?? current.prompt.vocabulary,
        }
      : current.prompt,
    history: partial.history ? { ...current.history, ...partial.history } : current.history,
  };
}

function sanitizeSettings(settings: AppSettings): AppSettings {
  const general = settings.general;

  return {
    ...cloneSettings(settings),
    stt: {
      ...settings.stt,
      base_url: settings.stt.base_url.trim(),
      api_key: settings.stt.api_key.trim(),
      model: settings.stt.model.trim(),
      language: settings.stt.language?.trim() || null,
    },
    llm: {
      ...settings.llm,
      base_url: settings.llm.base_url.trim(),
      api_key: settings.llm.api_key.trim(),
      model: settings.llm.model.trim(),
    },
    general: {
      ...general,
      theme: general.theme.trim(),
      language: general.language.trim(),
      hotkey: {
        ...general.hotkey,
        key: general.hotkey.key.trim(),
        held_keys: Array.from(
          new Set(
            general.hotkey.held_keys
              .map((key) => key.trim())
              .filter(Boolean),
          ),
        ),
      },
    },
    prompt: {
      ...settings.prompt,
      vocabulary: normalizeVocabularyEntries(settings.prompt.vocabulary),
    },
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  dirty: false,
  saveStatus: "idle",
  lastSaveError: null,
  validationError: null,

  loadSettings: async () => {
    set({ loading: true });
    try {
      const settings = isTauriRuntime()
        ? await invoke<AppSettings>("get_settings")
        : loadMockSettings();

      set({
        settings,
        loading: false,
        dirty: false,
        saveStatus: "idle",
        lastSaveError: null,
        validationError: validateSettings(settings),
      });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  saveSettings: async (settings: AppSettings) => {
    const sanitized = sanitizeSettings(settings);
    const validationError = validateSettings(sanitized);

    if (validationError) {
      set({
        validationError,
        lastSaveError: null,
        saveStatus: "idle",
      });
      throw new Error(validationError);
    }

    set({ saveStatus: "saving", lastSaveError: null, validationError: null });

    try {
      if (isTauriRuntime()) {
        await invoke("save_settings", { settings: sanitized });
      } else {
        saveMockSettings(sanitized);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        saveStatus: "error",
        lastSaveError: message,
        dirty: true,
      });
      throw new Error(message);
    }

    // If user made more changes while saving, stay in pending state.
    if (get().dirty) {
      set({ saveStatus: "pending" });
      return;
    }

    set({
      settings: sanitized,
      dirty: false,
      saveStatus: "saved",
      lastSaveError: null,
      validationError: null,
    });

    setTimeout(() => {
      const state = get();
      if (!state.dirty && state.saveStatus === "saved") {
        set({ saveStatus: "idle" });
      }
    }, 2000);
  },

  updateSettings: (partial) => {
    const current = get().settings;
    if (current) {
      const merged = mergeSettings(current, partial);
      const validationError = validateSettings(sanitizeSettings(merged));

      set({
        settings: merged,
        dirty: true,
        saveStatus: "pending",
        lastSaveError: null,
        validationError,
      });

      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      if (validationError) {
        return;
      }

      autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        const snapshot = get();
        if (snapshot.settings) {
          void get().saveSettings(snapshot.settings).catch(() => {});
        }
      }, 800);
    }
  },

  flushSettings: async () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }

    const { dirty, settings, validationError } = get();
    if (validationError) {
      throw new Error(validationError);
    }

    if (dirty && settings) {
      await get().saveSettings(settings);
    }
  },
}));
