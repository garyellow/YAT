import type { AppSettings, HotkeyConfig, PromptConfig } from "../stores/settingsStore";

export type DesktopPlatform = "windows" | "macos" | "linux" | "unknown";
export type HotkeyAdviceTone = "accent" | "warning" | "danger";

export interface HotkeyAdvice {
  tone: HotkeyAdviceTone;
  titleKey: string;
  bodyKey: string;
}

const FRIENDLY_KEY_LABELS: Record<string, string> = {
  alt: "Alt",
  lalt: "Left Alt",
  ralt: "Right Alt",
  altgr: "Right Alt",
  ctrl: "Ctrl",
  control: "Ctrl",
  lctrl: "Left Ctrl",
  rctrl: "Right Ctrl",
  shift: "Shift",
  lshift: "Left Shift",
  rshift: "Right Shift",
  meta: "Meta",
  super: "Super",
  cmd: "Cmd",
  command: "Command",
  lmeta: "Left Cmd",
  rmeta: "Right Cmd",
  rcmd: "Right Cmd",
  space: "Space",
  escape: "Esc",
  esc: "Esc",
  enter: "Enter",
  return: "Enter",
  backspace: "Backspace",
  tab: "Tab",
  capslock: "Caps Lock",
};

function normalizeKeyToken(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function isModifierToken(token: string): boolean {
  return [
    "alt",
    "lalt",
    "ralt",
    "altgr",
    "ctrl",
    "control",
    "lctrl",
    "rctrl",
    "shift",
    "lshift",
    "rshift",
    "meta",
    "super",
    "cmd",
    "command",
    "lmeta",
    "rmeta",
    "rcmd",
  ].includes(token);
}

function isTypingToken(token: string): boolean {
  return token.length === 1 || ["space", "tab", "enter", "return"].includes(token);
}

export function normalizePlatform(value?: string | null): DesktopPlatform {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (normalized.includes("win")) return "windows";
  if (normalized.includes("mac")) return "macos";
  if (normalized.includes("linux")) return "linux";
  return "unknown";
}

export function isFilled(value?: string | null): boolean {
  return Boolean(value?.trim());
}

export function isSttConfigured(settings: AppSettings | null): boolean {
  if (!settings) return false;
  return (
    isFilled(settings.stt.base_url) &&
    isFilled(settings.stt.api_key) &&
    isFilled(settings.stt.model)
  );
}

export function isLlmConfigured(settings: AppSettings | null): boolean {
  if (!settings) return false;
  if (!settings.llm.enabled) return true;
  return (
    isFilled(settings.llm.base_url) &&
    isFilled(settings.llm.api_key) &&
    isFilled(settings.llm.model)
  );
}

export function buildPromptPreview(prompt: PromptConfig): string {
  const parts = [prompt.system_prompt.trim()];

  if (prompt.user_instructions.trim()) {
    parts.push(`Additional user instructions:\n${prompt.user_instructions.trim()}`);
  }

  if (prompt.vocabulary.length > 0) {
    const vocabularyBlock = prompt.vocabulary
      .map((entry) => `- \"${entry.wrong}\" → \"${entry.correct}\"`)
      .join("\n");
    parts.push(`Vocabulary corrections (always apply these):\n${vocabularyBlock}`);
  }

  return parts.filter(Boolean).join("\n\n");
}

export function formatHotkeyKey(value?: string | null): string {
  const token = normalizeKeyToken(value);
  if (!token) return "—";

  if (FRIENDLY_KEY_LABELS[token]) {
    return FRIENDLY_KEY_LABELS[token];
  }

  if (token.length === 1) {
    return token.toUpperCase();
  }

  return value?.trim() || token;
}

export function getRecommendedHotkeyLabel(platform: DesktopPlatform): string {
  return platform === "macos" ? "Right Cmd" : "Right Ctrl";
}

export function getHotkeyAdvice(hotkey: HotkeyConfig): HotkeyAdvice {
  const key = normalizeKeyToken(hotkey.key);
  const mode = hotkey.hotkey_type;
  const isRightSideHold =
    mode === "hold" && ["rctrl", "rmeta", "rcmd"].includes(key);

  if (isRightSideHold) {
    return {
      tone: "accent",
      titleKey: "general.hotkeyRecommendedTitle",
      bodyKey: "general.hotkeyRecommendedBody",
    };
  }

  if (mode === "combo") {
    return {
      tone: "accent",
      titleKey: "general.hotkeyComboTitle",
      bodyKey: "general.hotkeyComboBody",
    };
  }

  if (mode === "hold" && isModifierToken(key)) {
    return {
      tone: "warning",
      titleKey: "general.hotkeyModifierHoldTitle",
      bodyKey: "general.hotkeyModifierHoldBody",
    };
  }

  if ((mode === "single" || mode === "double_tap") && isModifierToken(key)) {
    return {
      tone: "danger",
      titleKey: "general.hotkeyModifierRiskTitle",
      bodyKey: "general.hotkeyModifierRiskBody",
    };
  }

  if ((mode === "single" || mode === "double_tap") && isTypingToken(key)) {
    return {
      tone: "danger",
      titleKey: "general.hotkeyTypingRiskTitle",
      bodyKey: "general.hotkeyTypingRiskBody",
    };
  }

  return {
    tone: "warning",
    titleKey: "general.hotkeyCustomTitle",
    bodyKey: "general.hotkeyCustomBody",
  };
}

export function formatHotkeyCombo(hotkey: HotkeyConfig): string {
  const key = formatHotkeyKey(hotkey.key);
  const modifier = formatHotkeyKey(hotkey.modifier);

  switch (hotkey.hotkey_type) {
    case "combo":
      return hotkey.modifier?.trim() ? `${modifier} + ${key}` : key;
    case "double_tap":
      return `${key} ×2`;
    case "hold":
      return key;
    case "single":
    default:
      return key;
  }
}
