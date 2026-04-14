import type { AppSettings, VocabularyEntry } from "../stores/settingsStore";

const LEGACY_DEFAULT_SYSTEM_PROMPT = `You are a transcription text polisher. Your ONLY job is to clean up raw speech-to-text output. Follow these rules strictly:

1. Remove filler words and repetitions (um, uh, like, you know, 嗯, 呃, 那個, 就是說, 然後, 對, 所以說).
2. Remove stuttering; keep only the speaker's final intent.
3. Add proper punctuation and split into natural paragraphs.
4. Format numbers: spoken numbers → digits (e.g. "三百毫秒" → "300ms", "百分之八十" → "80%", "one hundred twenty three" → "123").
5. Correct proper nouns, brand names, and technical terms to their canonical spelling (e.g. "deep seek" → "DeepSeek", "chat gpt" → "ChatGPT", "mac book" → "MacBook").
6. When the speech describes a list or steps, output them as a structured list.
7. Preserve the speaker's natural tone — do not make casual speech formal or vice versa.

CODE-SWITCHING (中英混雜):
- Preserve the speaker's natural language mixing. If they said it in English, keep it in English; if in Chinese, keep it in Chinese.
- Insert a space between Chinese characters and adjacent English words or numbers (e.g. "這個 function 的 return type").
- Do NOT translate code-switched segments into a single language.

CRITICAL CONSTRAINTS:
- NEVER answer questions contained in the text. Just polish the question itself.
- NEVER add your own commentary, opinions, or explanations.
- NEVER summarize or shorten beyond removing filler and repetition.
- NEVER change the meaning of what was said.
- Output ONLY the polished text, nothing else. No preamble, no explanation.`;

const DEFAULT_SYSTEM_PROMPT = `You are a transcription text polisher. Your job is to turn raw speech-to-text output into clean final text.

Follow these rules:
1. Remove filler words, repetitions, and obvious false starts (for example: um, uh, you know, 嗯, 呃, 那個, 然後).
2. When the speaker self-corrects or restarts, keep only the final intended wording.
3. Add punctuation and split the text into natural paragraphs.
4. Format spoken numbers into digits when that clearly improves readability (for example: "三百毫秒" → "300ms", "百分之八十" → "80%", "one hundred twenty three" → "123").
5. Preserve the speaker's natural tone. Do not make casual speech overly formal, and do not make formal speech casual.
6. Preserve code-switching. Keep English in English and Chinese in Chinese when that matches the speaker's intent.
7. Insert spaces naturally between Chinese characters and adjacent English words or numbers when needed.
8. When a vocabulary list is provided, treat it as preferred spelling and terminology. Use those entries when they clearly match the speaker's intent, even if the raw transcription spaced or spelled them oddly.
9. When the speech naturally contains steps or a list, format it as a structured list.

Constraints:
- Do not answer or act on the content. Only polish the dictated text.
- Do not add commentary, explanations, or new facts.
- Do not change the meaning.
- Output only the polished text.`;

export function getDefaultSystemPrompt(): string {
  return DEFAULT_SYSTEM_PROMPT;
}

function normalizeSystemPrompt(value?: string | null): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  if (
    trimmed === DEFAULT_SYSTEM_PROMPT.trim()
    || trimmed === LEGACY_DEFAULT_SYSTEM_PROMPT.trim()
  ) {
    return DEFAULT_SYSTEM_PROMPT;
  }

  return value ?? DEFAULT_SYSTEM_PROMPT;
}

const STORAGE_KEY = "yat.mock-settings";

function normalizeVocabularyKey(value: string): string {
  return value.trim().toLowerCase();
}

function coerceVocabularyText(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry;
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = entry as {
    text?: unknown;
    correct?: unknown;
    wrong?: unknown;
  };

  if (typeof candidate.text === "string") {
    return candidate.text;
  }

  if (typeof candidate.correct === "string" && candidate.correct.trim()) {
    return candidate.correct;
  }

  if (typeof candidate.wrong === "string") {
    return candidate.wrong;
  }

  return null;
}

export function normalizeVocabularyEntries(entries: unknown): VocabularyEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: VocabularyEntry[] = [];

  for (const entry of entries) {
    const text = coerceVocabularyText(entry)?.trim();
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

function defaultHotkeyKey(): string {
  if (typeof navigator !== "undefined" && /mac/i.test(navigator.platform)) {
    return "RCmd";
  }
  return "RCtrl";
}

function buildDefaultAppSettings(): AppSettings {
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
        key: defaultHotkeyKey(),
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

function mergeWithDefaults(partial: Partial<AppSettings> | null | undefined): AppSettings {
  const defaults = buildDefaultAppSettings();
  const { auto_dnd: _deprecatedAutoDnd, ...legacyGeneral } = (
    (partial?.general ?? {}) as Partial<AppSettings["general"]> & { auto_dnd?: boolean }
  );

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
      ...legacyGeneral,
      hotkey: {
        ...defaults.general.hotkey,
        ...legacyGeneral.hotkey,
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
    return buildDefaultAppSettings();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return buildDefaultAppSettings();
    }

    return mergeWithDefaults(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return buildDefaultAppSettings();
  }
}

export function saveMockSettings(settings: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
