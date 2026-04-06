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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

const HOTKEY_TOKEN_ALIASES: Record<string, string> = {
  alt: "alt",
  lalt: "lalt",
  ralt: "ralt",
  altgr: "ralt",
  ctrl: "ctrl",
  control: "ctrl",
  lctrl: "lctrl",
  rctrl: "rctrl",
  shift: "shift",
  lshift: "lshift",
  rshift: "rshift",
  meta: "meta",
  super: "meta",
  cmd: "meta",
  command: "meta",
  lmeta: "lmeta",
  rmeta: "rmeta",
  rcmd: "rmeta",
  space: "space",
  escape: "escape",
  esc: "escape",
  tab: "tab",
  capslock: "capslock",
  backspace: "backspace",
  enter: "enter",
  return: "enter",
};

type HotkeyMatcherCategory =
  | "ctrl"
  | "shift"
  | "meta"
  | `exact:${string}`;

export type HotkeyValidationCode =
  | "missing_key"
  | "escape_reserved"
  | "unsupported_key"
  | "missing_modifier"
  | "unsupported_modifier"
  | "same_key_and_modifier"
  | "invalid_double_tap_interval";

export interface HotkeyValidationError {
  code: HotkeyValidationCode;
}

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

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) {
    return false;
  }

  if (octets[0] === 10 || octets[0] === 127) {
    return true;
  }

  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  return octets[0] === 169 && octets[1] === 254;
}

function endpointNeedsApiKey(baseUrl?: string | null): boolean {
  return isFilled(baseUrl) && !isLocalEndpointUrl(baseUrl);
}

function normalizeHotkeyMatcherToken(token: string): HotkeyMatcherCategory | null {
  const normalized = HOTKEY_TOKEN_ALIASES[token] ?? token;

  switch (normalized) {
    case "ctrl":
      return "ctrl";
    case "shift":
      return "shift";
    case "meta":
      return "meta";
    case "lalt":
    case "ralt":
    case "lctrl":
    case "rctrl":
    case "lshift":
    case "rshift":
    case "lmeta":
    case "rmeta":
    case "space":
    case "escape":
    case "tab":
    case "capslock":
    case "backspace":
    case "enter":
      return `exact:${normalized}`;
    default:
      return normalized.length === 1 ? `exact:${normalized}` : null;
  }
}

function hotkeyMatchersOverlap(a: HotkeyMatcherCategory, b: HotkeyMatcherCategory): boolean {
  if (a === b) {
    return true;
  }

  return (
    (a === "ctrl" && ["exact:lctrl", "exact:rctrl"].includes(b)) ||
    (b === "ctrl" && ["exact:lctrl", "exact:rctrl"].includes(a)) ||
    (a === "shift" && ["exact:lshift", "exact:rshift"].includes(b)) ||
    (b === "shift" && ["exact:lshift", "exact:rshift"].includes(a)) ||
    (a === "meta" && ["exact:lmeta", "exact:rmeta"].includes(b)) ||
    (b === "meta" && ["exact:lmeta", "exact:rmeta"].includes(a))
  );
}

export function normalizePlatform(value?: string | null): DesktopPlatform {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (normalized.includes("win")) return "windows";
  if (normalized.includes("mac")) return "macos";
  if (normalized.includes("linux")) return "linux";
  return "unknown";
}

export function isLocalEndpointUrl(value?: string | null): boolean {
  if (!isFilled(value)) return false;

  try {
    const url = new URL(value!.trim());
    const hostname = url.hostname.toLowerCase();

    return (
      LOOPBACK_HOSTS.has(hostname) ||
      hostname.endsWith(".local") ||
      isPrivateIpv4(hostname)
    );
  } catch {
    return false;
  }
}

export function isFilled(value?: string | null): boolean {
  return Boolean(value?.trim());
}

export function isSttConfigured(settings: AppSettings | null): boolean {
  if (!settings) return false;
  return (
    isFilled(settings.stt.base_url) &&
    isFilled(settings.stt.model) &&
    (!endpointNeedsApiKey(settings.stt.base_url) || isFilled(settings.stt.api_key))
  );
}

export function isLlmConfigured(settings: AppSettings | null): boolean {
  if (!settings) return false;
  if (!settings.llm.enabled) return true;
  return (
    isFilled(settings.llm.base_url) &&
    isFilled(settings.llm.model) &&
    (!endpointNeedsApiKey(settings.llm.base_url) || isFilled(settings.llm.api_key))
  );
}

export function validateHotkeyConfig(hotkey: HotkeyConfig): HotkeyValidationError | null {
  const keyToken = normalizeKeyToken(hotkey.key);
  if (!keyToken) {
    return { code: "missing_key" };
  }

  if (keyToken === "escape") {
    return { code: "escape_reserved" };
  }

  const keyMatcher = normalizeHotkeyMatcherToken(keyToken);
  if (!keyMatcher) {
    return { code: "unsupported_key" };
  }

  if (hotkey.hotkey_type === "double_tap") {
    if (hotkey.double_tap_interval_ms < 100 || hotkey.double_tap_interval_ms > 1000) {
      return { code: "invalid_double_tap_interval" };
    }
  }

  if (hotkey.hotkey_type !== "combo") {
    return null;
  }

  const modifierToken = normalizeKeyToken(hotkey.modifier);
  if (!modifierToken) {
    return { code: "missing_modifier" };
  }

  if (modifierToken === "escape") {
    return { code: "escape_reserved" };
  }

  const modifierMatcher = normalizeHotkeyMatcherToken(modifierToken);
  if (!modifierMatcher) {
    return { code: "unsupported_modifier" };
  }

  if (hotkeyMatchersOverlap(keyMatcher, modifierMatcher)) {
    return { code: "same_key_and_modifier" };
  }

  return null;
}

export function formatHotkeyValidationError(error: HotkeyValidationError): string {
  switch (error.code) {
    case "missing_key":
      return "Hotkey key cannot be empty.";
    case "escape_reserved":
      return "Escape is reserved for cancelling recordings.";
    case "unsupported_key":
      return "Unsupported hotkey key. Use a single character, F1–F12, Alt, Ctrl, Shift, Meta, Space, Tab, CapsLock, Backspace, or Enter.";
    case "missing_modifier":
      return "Combo hotkeys require a modifier.";
    case "unsupported_modifier":
      return "Unsupported hotkey modifier. Use Alt, Ctrl, Shift, Meta, Space, Tab, CapsLock, Backspace, Enter, or a single character.";
    case "same_key_and_modifier":
      return "Hotkey key and modifier must be different.";
    case "invalid_double_tap_interval":
      return "Double-tap interval must be between 100ms and 1000ms.";
    default:
      return "The current hotkey configuration is invalid.";
  }
}

export function validateSettings(settings: AppSettings): string | null {
  const hotkeyError = validateHotkeyConfig(settings.general.hotkey);
  return hotkeyError ? formatHotkeyValidationError(hotkeyError) : null;
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

// ── Browser KeyboardEvent.code → rdev key name mapping ────────────────

const BROWSER_CODE_TO_RDEV: Record<string, string> = {
  // Modifiers
  ControlLeft: "LCtrl",
  ControlRight: "RCtrl",
  ShiftLeft: "LShift",
  ShiftRight: "RShift",
  AltLeft: "Alt",
  AltRight: "RAlt",
  MetaLeft: "LMeta",
  MetaRight: "RMeta",
  // Function keys
  F1: "F1", F2: "F2", F3: "F3", F4: "F4",
  F5: "F5", F6: "F6", F7: "F7", F8: "F8",
  F9: "F9", F10: "F10", F11: "F11", F12: "F12",
  // Special keys
  Space: "Space",
  Escape: "Escape",
  Tab: "Tab",
  CapsLock: "CapsLock",
  Backspace: "Backspace",
  Enter: "Enter",
  // Letters
  KeyA: "A", KeyB: "B", KeyC: "C", KeyD: "D",
  KeyE: "E", KeyF: "F", KeyG: "G", KeyH: "H",
  KeyI: "I", KeyJ: "J", KeyK: "K", KeyL: "L",
  KeyM: "M", KeyN: "N", KeyO: "O", KeyP: "P",
  KeyQ: "Q", KeyR: "R", KeyS: "S", KeyT: "T",
  KeyU: "U", KeyV: "V", KeyW: "W", KeyX: "X",
  KeyY: "Y", KeyZ: "Z",
  // Digits
  Digit0: "0", Digit1: "1", Digit2: "2", Digit3: "3",
  Digit4: "4", Digit5: "5", Digit6: "6", Digit7: "7",
  Digit8: "8", Digit9: "9",
};

const MODIFIER_RDEV_NAMES = new Set([
  "Alt", "RAlt", "LCtrl", "RCtrl", "LShift", "RShift", "LMeta", "RMeta",
]);

/** Map a browser KeyboardEvent.code to the canonical rdev key name used in config. */
export function browserCodeToRdevName(code: string): string | null {
  return BROWSER_CODE_TO_RDEV[code] ?? null;
}

/** Sort key names so modifiers come before regular keys. */
export function sortModifiersFirst(keys: string[]): string[] {
  const mods = keys.filter((k) => MODIFIER_RDEV_NAMES.has(k));
  const rest = keys.filter((k) => !MODIFIER_RDEV_NAMES.has(k));
  return [...mods, ...rest];
}
