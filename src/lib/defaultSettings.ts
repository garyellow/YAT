import type { AppSettings, VocabularyEntry } from "../stores/settingsStore";
import type { DesktopPlatform } from "./settingsFormatters";

// System prompt default lives in the backend (config.rs::default_system_prompt).
// Frontend uses empty string as "use backend default".

const STORAGE_KEY = "yat.mock-settings";

function normalizeVocabularyKey(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeVocabularyEntries(entries: unknown): VocabularyEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: VocabularyEntry[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const text = typeof (entry as { text?: unknown }).text === "string"
      ? (entry as { text: string }).text.trim()
      : "";

    if (!text) {
      continue;
    }

    const key = normalizeVocabularyKey(text);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({ text });
  }

  return normalized;
}

export function getDefaultHotkeyKeyForPlatform(platform?: DesktopPlatform | string | null): string {
  const normalized = typeof platform === "string" ? platform.toLowerCase() : "";

  if (normalized.includes("mac")) {
    return "RCmd";
  }

  if (normalized && normalized !== "unknown") {
    return "RCtrl";
  }

  const detectedPlatform = typeof navigator !== "undefined"
    ? ((navigator as any).userAgentData?.platform ?? navigator.platform)
    : "";

  if (/mac/i.test(detectedPlatform)) {
    return "RCmd";
  }

  return "RCtrl";
}

export function createDefaultAppSettings(platform?: DesktopPlatform | string | null): AppSettings {
  return {
    stt: {
      base_url: "",
      api_key: "",
      model: "",
      language: null,
    },
    llm: {
      enabled: false,
      base_url: "",
      api_key: "",
      model: "",
    },
    general: {
      hotkey: {
        hotkey_type: "hold",
        key: getDefaultHotkeyKeyForPlatform(platform),
        held_keys: [],
        double_tap_interval_ms: 300,
      },
      theme: "system",
      auto_start: false,
      max_recording_seconds: 180,
      output_mode: "auto_paste",
      clipboard_behavior: "always",
      language: "zh-TW",
      timeout_ms: 30000,
      max_retries: 2,
      sound_effects: true,
      background_audio_mode: "duck",
      background_audio_ducking_percent: 80,
      auto_pause_media: false,
      microphone_device: null,
      close_to_tray: true,
      start_minimized: true,
    },
    prompt: {
      system_prompt: "",
      user_instructions: "",
      vocabulary: [],
      context_clipboard: false,
      context_selection: false,
      context_active_app: false,
      context_input_field: false,
      context_screenshot: false,
    },
    history: {
      retention_hours: 720,
      context_window_minutes: 10,
      audio_retention_hours: 24,
    },
  };
}

export function cloneSettings(settings: AppSettings): AppSettings {
  if (typeof structuredClone === "function") {
    return structuredClone(settings);
  }
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

export function hydrateSettings(
  partial: Partial<AppSettings> | null | undefined,
  platform?: DesktopPlatform | string | null,
): AppSettings {
  const defaults = createDefaultAppSettings(platform);
  const generalOverride = (partial?.general ?? {}) as Partial<AppSettings["general"]>;

  return {
    stt: {
      ...defaults.stt,
      ...partial?.stt,
    },
    llm: {
      ...defaults.llm,
      ...partial?.llm,
    },
    general: {
      ...defaults.general,
      ...generalOverride,
      hotkey: {
        ...defaults.general.hotkey,
        ...generalOverride.hotkey,
      },
    },
    prompt: {
      ...defaults.prompt,
      ...partial?.prompt,
      system_prompt: partial?.prompt?.system_prompt ?? defaults.prompt.system_prompt,
      vocabulary: normalizeVocabularyEntries(
        partial?.prompt?.vocabulary ?? defaults.prompt.vocabulary,
      ),
    },
    history: {
      ...defaults.history,
      ...partial?.history,
    },
  };
}

export function loadMockSettings(): AppSettings {
  if (typeof window === "undefined") {
    return createDefaultAppSettings();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultAppSettings();
    }

    return hydrateSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return createDefaultAppSettings();
  }
}

export function saveMockSettings(settings: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
