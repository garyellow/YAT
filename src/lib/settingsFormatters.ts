import type { AppSettings, HotkeyConfig, PromptConfig } from "../stores/settingsStore";

export type DesktopPlatform = "windows" | "macos" | "linux" | "unknown";

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
  // Navigation
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  home: "Home",
  end: "End",
  pageup: "Page Up",
  pagedown: "Page Down",
  insert: "Insert",
  delete: "Delete",
  // Punctuation / symbols
  comma: ",",
  period: ".",
  dot: ".",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  apostrophe: "'",
  backquote: "`",
  grave: "`",
  leftbracket: "[",
  rightbracket: "]",
  minus: "−",
  hyphen: "−",
  equal: "=",
  intlbackslash: "IntlBackslash",
  // Numpad
  kp0: "Numpad 0",
  kp1: "Numpad 1",
  kp2: "Numpad 2",
  kp3: "Numpad 3",
  kp4: "Numpad 4",
  kp5: "Numpad 5",
  kp6: "Numpad 6",
  kp7: "Numpad 7",
  kp8: "Numpad 8",
  kp9: "Numpad 9",
  kpreturn: "Numpad Enter",
  kpminus: "Numpad −",
  kpplus: "Numpad +",
  kpmultiply: "Numpad ×",
  kpdivide: "Numpad ÷",
  kpdelete: "Numpad .",
  numlock: "Num Lock",
  // Lock / misc
  printscreen: "Print Screen",
  scrolllock: "Scroll Lock",
  pause: "Pause",
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
  // Navigation
  up: "up",
  arrowup: "up",
  down: "down",
  arrowdown: "down",
  left: "left",
  arrowleft: "left",
  right: "right",
  arrowright: "right",
  home: "home",
  end: "end",
  pageup: "pageup",
  pagedown: "pagedown",
  insert: "insert",
  delete: "delete",
  // Punctuation / symbols
  comma: "comma",
  period: "period",
  dot: "period",
  slash: "slash",
  backslash: "backslash",
  semicolon: "semicolon",
  quote: "quote",
  apostrophe: "quote",
  backquote: "backquote",
  grave: "backquote",
  leftbracket: "leftbracket",
  bracketleft: "leftbracket",
  rightbracket: "rightbracket",
  bracketright: "rightbracket",
  minus: "minus",
  hyphen: "minus",
  equal: "equal",
  equals: "equal",
  intlbackslash: "intlbackslash",
  // Numpad
  kp0: "kp0",
  numpad0: "kp0",
  kp1: "kp1",
  numpad1: "kp1",
  kp2: "kp2",
  numpad2: "kp2",
  kp3: "kp3",
  numpad3: "kp3",
  kp4: "kp4",
  numpad4: "kp4",
  kp5: "kp5",
  numpad5: "kp5",
  kp6: "kp6",
  numpad6: "kp6",
  kp7: "kp7",
  numpad7: "kp7",
  kp8: "kp8",
  numpad8: "kp8",
  kp9: "kp9",
  numpad9: "kp9",
  kpreturn: "kpreturn",
  numpadenter: "kpreturn",
  kpminus: "kpminus",
  numpadsubtract: "kpminus",
  kpplus: "kpplus",
  numpadadd: "kpplus",
  kpmultiply: "kpmultiply",
  numpadmultiply: "kpmultiply",
  kpdivide: "kpdivide",
  numpaddivide: "kpdivide",
  kpdelete: "kpdelete",
  numpaddecimal: "kpdelete",
  numlock: "numlock",
  // Lock / misc
  printscreen: "printscreen",
  scrolllock: "scrolllock",
  pause: "pause",
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

function normalizeKeyList(values?: string[] | null): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeKeyToken(value))
        .filter(Boolean),
    ),
  );
}

function normalizeKeyToken(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
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
    default: {
      // Known alias → exact key
      if (HOTKEY_TOKEN_ALIASES[token] !== undefined) {
        return `exact:${normalized}`;
      }
      // F1–F12
      if (/^f(?:1[0-2]?|[2-9])$/.test(normalized)) {
        return `exact:${normalized}`;
      }
      // Single character (letter / digit / symbol)
      return normalized.length === 1 ? `exact:${normalized}` : null;
    }
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

function isFilled(value?: string | null): boolean {
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

  const heldKeys = normalizeKeyList(hotkey.held_keys);
  if (heldKeys.length === 0) {
    return { code: "missing_modifier" };
  }

  const seenMatchers: HotkeyMatcherCategory[] = [];
  for (const heldKey of heldKeys) {
    if (heldKey === "escape") {
      return { code: "escape_reserved" };
    }

    const heldMatcher = normalizeHotkeyMatcherToken(heldKey);
    if (!heldMatcher) {
      return { code: "unsupported_modifier" };
    }

    if (
      hotkeyMatchersOverlap(keyMatcher, heldMatcher)
      || seenMatchers.some((matcher) => hotkeyMatchersOverlap(matcher, heldMatcher))
    ) {
      return { code: "same_key_and_modifier" };
    }

    seenMatchers.push(heldMatcher);
  }

  return null;
}

export function validateSettings(settings: AppSettings): HotkeyValidationCode | null {
  const hotkeyError = validateHotkeyConfig(settings.general.hotkey);
  return hotkeyError ? hotkeyError.code : null;
}

export function formatConnectionError(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
  serviceLabel: string,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.toLowerCase();

  if (/timeout|timed out|deadline exceeded/.test(normalized)) {
    return t("settings.connectionErrorTimeout", { service: serviceLabel });
  }
  if (/401|unauthorized|authentication|invalid api key|api key required/.test(normalized)) {
    return t("settings.connectionErrorUnauthorized", { service: serviceLabel });
  }
  if (/403|forbidden|permission denied|insufficient/.test(normalized)) {
    return t("settings.connectionErrorForbidden", { service: serviceLabel });
  }
  if (/404|not found|no such model|model_not_found/.test(normalized)) {
    return t("settings.connectionErrorNotFound", { service: serviceLabel });
  }
  if (/connection|network|dns|refused|socket|unreachable|failed to fetch/.test(normalized)) {
    return t("settings.connectionErrorNetwork", { service: serviceLabel });
  }

  return t("settings.connectionErrorUnknown", { service: serviceLabel, error: raw });
}

export function buildPromptPreview(prompt: PromptConfig): string {
  const parts = [prompt.system_prompt.trim()];

  if (prompt.user_instructions.trim()) {
    parts.push(`Additional user instructions:\n${prompt.user_instructions.trim()}`);
  }

  if (prompt.vocabulary.length > 0) {
    const vocabularyBlock = prompt.vocabulary
      .map((entry) => `- ${entry.text}`)
      .join("\n");
    parts.push(
      `Preferred vocabulary and spelling:\nUse these words or phrases when they match the speaker's intent. They are reference terms, not search-and-replace rules.\n${vocabularyBlock}`,
    );
  }

  const ctxParts: string[] = [];
  if (prompt.context_active_app) ctxParts.push("active app");
  if (prompt.context_selection) ctxParts.push("selected text");
  if (prompt.context_input_field) ctxParts.push("input field");
  if (prompt.context_clipboard) ctxParts.push("clipboard");
  if (prompt.context_screenshot) ctxParts.push("screenshot");
  if (ctxParts.length > 0) {
    parts.push(`[Context sources enabled: ${ctxParts.join(", ")}]`);
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

export function formatHotkeyCombo(hotkey: HotkeyConfig): string {
  const key = formatHotkeyKey(hotkey.key);
  const heldKeys = normalizeKeyList(hotkey.held_keys).map(formatHotkeyKey);

  switch (hotkey.hotkey_type) {
    case "combo":
      return [...heldKeys, key].join(" + ");
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
  // Navigation
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  Delete: "Delete",
  // Punctuation / symbols
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "Backslash",
  Semicolon: "Semicolon",
  Quote: "Quote",
  Backquote: "Backquote",
  BracketLeft: "LeftBracket",
  BracketRight: "RightBracket",
  Minus: "Minus",
  Equal: "Equal",
  IntlBackslash: "IntlBackslash",
  // Numpad
  Numpad0: "Kp0",
  Numpad1: "Kp1",
  Numpad2: "Kp2",
  Numpad3: "Kp3",
  Numpad4: "Kp4",
  Numpad5: "Kp5",
  Numpad6: "Kp6",
  Numpad7: "Kp7",
  Numpad8: "Kp8",
  Numpad9: "Kp9",
  NumpadEnter: "KpReturn",
  NumpadSubtract: "KpMinus",
  NumpadAdd: "KpPlus",
  NumpadMultiply: "KpMultiply",
  NumpadDivide: "KpDivide",
  NumpadDecimal: "KpDelete",
  NumLock: "NumLock",
  // Lock / misc
  PrintScreen: "PrintScreen",
  ScrollLock: "ScrollLock",
  Pause: "Pause",
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
