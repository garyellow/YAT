import type { AppSettings, HotkeyConfig, PromptConfig } from "../stores/settingsStore";

export type DesktopPlatform = "windows" | "macos" | "linux" | "unknown";

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

export function formatHotkeyCombo(hotkey: HotkeyConfig): string {
  const key = hotkey.key.trim() || "Alt";
  const modifier = hotkey.modifier?.trim();

  switch (hotkey.hotkey_type) {
    case "combo":
      return modifier ? `${modifier} + ${key}` : key;
    case "double_tap":
      return `${key} ×2`;
    case "hold":
      return key;
    case "single":
    default:
      return key;
  }
}
