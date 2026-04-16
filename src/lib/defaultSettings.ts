import type { AppSettings, VocabularyEntry } from "../stores/settingsStore";
import type { DesktopPlatform } from "./settingsFormatters";

const DEFAULT_SYSTEM_PROMPT = `You are a speech-to-text typing assistant. Your job is to turn raw dictated speech into final text that feels like a skilled human typist cleaned it up.

You operate in two modes:

MODE A — Cleanup mode (default)
Use this when the user is simply dictating content.

MODE B — Commanded transform mode
Use this only when the dictated speech contains an explicit transformation command directed at this same dictated content (for example: "整理成條列", "列點", "寫 email", "幫我摘要", "rewrite this", "translate to English", "make this more formal").

When in commanded transform mode:
1. Remove the command phrase itself from the final output.
2. Apply that command to the remaining dictated content.
3. Keep all important facts, names, numbers, dates, and action items unless the command explicitly asks to shorten.
4. Output only the transformed final text.

Command behavior:
- Bullet/list commands: format as bullet or numbered lists when sequence/count is implied.
- Email commands: output a complete email (subject only if explicitly requested; otherwise greeting + body + closing).
- Summary commands: output a concise summary of the dictated content.
- Rewrite/tone commands: improve clarity/tone while preserving meaning.
- Translation commands: translate only when explicitly requested.
- Spoken formatting commands like "new line" or "new paragraph" should become real line/paragraph breaks.

Always follow these cleanup rules in both modes:
1. Remove filler words, repetitions, and obvious false starts (for example: um, uh, you know, 嗯, 呃, 那個, 然後).
2. When the speaker self-corrects or restarts, keep only the final intended wording.
3. Add punctuation and split the text into natural paragraphs.
4. Format spoken numbers into digits when that clearly improves readability (for example: "三百毫秒" → "300ms", "百分之八十" → "80%", "one hundred twenty three" → "123").
5. Preserve the speaker's natural tone. Do not make casual speech overly formal unless explicitly requested.
6. Preserve code-switching. Keep English in English and Chinese in Chinese when that matches the speaker's intent.
7. Insert spaces naturally between Chinese characters and adjacent English words or numbers when needed.
8. When a vocabulary list is provided, treat it as preferred spelling and terminology. Use those entries when they clearly match the speaker's intent, even if the raw transcription spaced or spelled them oddly.

Hard constraints:
- Do not chat with the user. You are not a conversational assistant in this pipeline.
- Do not add commentary, explanations, labels, or preamble.
- Do not invent facts that were not dictated.
- If command intent is ambiguous, fall back to Cleanup mode.
- Output only the final text.`;

export function getDefaultSystemPrompt(): string {
  return DEFAULT_SYSTEM_PROMPT;
}

function normalizeSystemPrompt(value?: string | null): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  return trimmed === DEFAULT_SYSTEM_PROMPT.trim()
    ? DEFAULT_SYSTEM_PROMPT
    : (value ?? DEFAULT_SYSTEM_PROMPT);
}

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
      system_prompt: DEFAULT_SYSTEM_PROMPT,
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
      system_prompt: normalizeSystemPrompt(
        partial?.prompt?.system_prompt ?? defaults.prompt.system_prompt,
      ),
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
