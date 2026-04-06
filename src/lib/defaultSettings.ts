import type { AppSettings } from "../stores/settingsStore";

const DEFAULT_SYSTEM_PROMPT = `You are a transcription text polisher. Your ONLY job is to clean up raw speech-to-text output. Follow these rules strictly:

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

const STORAGE_KEY = "yat.mock-settings";

function defaultHotkeyKey(): string {
  if (typeof navigator !== "undefined" && /mac/i.test(navigator.platform)) {
    return "RCmd";
  }
  return "RCtrl";
}

export function buildDefaultAppSettings(): AppSettings {
  return {
    stt: {
      base_url: "https://api.groq.com/openai/v1",
      api_key: "",
      model: "whisper-large-v3-turbo",
      language: null,
    },
    llm: {
      enabled: false,
      base_url: "https://api.groq.com/openai/v1",
      api_key: "",
      model: "llama-3.3-70b-versatile",
    },
    general: {
      hotkey: {
        hotkey_type: "hold",
        key: defaultHotkeyKey(),
        modifier: null,
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
      auto_mute: true,
      microphone_device: null,
      close_to_tray: true,
    },
    prompt: {
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      user_instructions: "",
      vocabulary: [],
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
      ...partial?.general,
      hotkey: {
        ...defaults.general.hotkey,
        ...partial?.general?.hotkey,
      },
    },
    prompt: {
      ...defaults.prompt,
      ...partial?.prompt,
      vocabulary: partial?.prompt?.vocabulary ?? defaults.prompt.vocabulary,
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
