import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  GeneralConfig,
  HistoryConfig,
  HotkeyConfig,
  PromptConfig,
  VocabularyEntry,
} from "../stores/settingsStore";
import {
  cloneSettings,
  createDefaultAppSettings,
  getDefaultHotkeyKeyForPlatform,
  hydrateSettings,
  normalizeVocabularyEntries,
} from "./defaultSettings";
import {
  type DesktopPlatform,
  normalizePlatform,
  validateSettings,
} from "./settingsFormatters";
import { isTauriRuntime } from "./tauriRuntime";

const TRANSFER_APP = "YAT";
const TRANSFER_SCHEMA_VERSION = 1;
const HOTKEY_TYPES = ["single", "double_tap", "combo", "hold"] as const;
const THEMES = ["system", "light", "dark"] as const;
const LANGUAGES = ["zh-TW", "en"] as const;
const OUTPUT_MODES = ["auto_paste", "clipboard_only"] as const;
const CLIPBOARD_BEHAVIORS = ["always", "only_on_paste_fail"] as const;
const BACKGROUND_AUDIO_MODES = ["off", "duck", "mute"] as const;

type TransferKind = "settings" | "vocabulary";

interface TransferMetadata {
  exportedAt: string;
  sourcePlatform: DesktopPlatform;
}

export interface SettingsTransferPayload {
  stt: {
    base_url: string;
    model: string;
    language: string | null;
  };
  llm: {
    enabled: boolean;
    base_url: string;
    model: string;
  };
  general: GeneralConfig;
  prompt: PromptConfig;
  history: HistoryConfig;
}

export interface SettingsTransferBundle {
  app: typeof TRANSFER_APP;
  schemaVersion: typeof TRANSFER_SCHEMA_VERSION;
  kind: "settings";
  metadata: TransferMetadata & {
    secretsIncluded: false;
  };
  payload: SettingsTransferPayload;
}

export interface VocabularyTransferBundle {
  app: typeof TRANSFER_APP;
  schemaVersion: typeof TRANSFER_SCHEMA_VERSION;
  kind: "vocabulary";
  metadata: TransferMetadata;
  payload: {
    vocabulary: VocabularyEntry[];
  };
}

export type TransferBundle = SettingsTransferBundle | VocabularyTransferBundle;

export type SettingsImportReviewKey =
  | "api_keys_not_imported"
  | "microphone_device_reset"
  | "hotkey_default_adjusted"
  | "hotkey_review_recommended"
  | "hotkey_preserved_current";

export interface SettingsImportPlan {
  settings: AppSettings;
  sourcePlatform: DesktopPlatform;
  reviewItems: SettingsImportReviewKey[];
}

export interface VocabularyImportPlan {
  vocabulary: VocabularyEntry[];
  sourcePlatform: DesktopPlatform;
  importedCount: number;
  addedCount: number;
  skippedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
}

function expectString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new Error(message);
  }

  return value;
}

function expectNullableString(value: unknown, message: string): string | null {
  if (value == null) {
    return null;
  }

  return expectString(value, message);
}

function expectBoolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(message);
  }

  return value;
}

function expectInteger(
  value: unknown,
  message: string,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(message);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(message);
  }

  if (options.max !== undefined && value > options.max) {
    throw new Error(message);
  }

  return value;
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  message: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(message);
  }

  return value as T;
}

function expectStringArray(value: unknown, message: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(message);
  }

  return value;
}

function parseTransferMetadata(value: unknown): TransferMetadata {
  const metadata = expectRecord(value, "Transfer file is missing required metadata.");

  return {
    exportedAt: expectString(metadata.exportedAt, "Transfer file is missing its export timestamp."),
    sourcePlatform: normalizePlatform(
      expectString(metadata.sourcePlatform, "Transfer file is missing its source platform."),
    ),
  };
}

function parseHotkeyConfig(value: unknown): HotkeyConfig {
  const hotkey = expectRecord(value, "Transfer file contains an invalid hotkey configuration.");

  return {
    hotkey_type: expectEnum(
      hotkey.hotkey_type,
      HOTKEY_TYPES,
      "Transfer file contains an invalid hotkey type.",
    ),
    key: expectString(hotkey.key, "Transfer file contains an invalid hotkey key.").trim(),
    held_keys: Array.from(
      new Set(
        expectStringArray(
          hotkey.held_keys,
          "Transfer file contains invalid hotkey modifiers.",
        )
          .map((key) => key.trim())
          .filter(Boolean),
      ),
    ),
    double_tap_interval_ms: expectInteger(
      hotkey.double_tap_interval_ms,
      "Transfer file contains an invalid hotkey interval.",
      { min: 1 },
    ),
  };
}

function parseGeneralConfig(value: unknown): GeneralConfig {
  const general = expectRecord(value, "Transfer file contains invalid general settings.");

  return {
    hotkey: parseHotkeyConfig(general.hotkey),
    theme: expectEnum(general.theme, THEMES, "Transfer file contains an invalid theme."),
    auto_start: expectBoolean(general.auto_start, "Transfer file contains an invalid auto-start setting."),
    max_recording_seconds: expectInteger(
      general.max_recording_seconds,
      "Transfer file contains an invalid max recording duration.",
      { min: 1 },
    ),
    output_mode: expectEnum(
      general.output_mode,
      OUTPUT_MODES,
      "Transfer file contains an invalid output mode.",
    ),
    clipboard_behavior: expectEnum(
      general.clipboard_behavior,
      CLIPBOARD_BEHAVIORS,
      "Transfer file contains an invalid clipboard behavior.",
    ),
    language: expectEnum(general.language, LANGUAGES, "Transfer file contains an invalid language."),
    timeout_ms: expectInteger(
      general.timeout_ms,
      "Transfer file contains an invalid timeout.",
      { min: 1 },
    ),
    max_retries: expectInteger(
      general.max_retries,
      "Transfer file contains an invalid retry count.",
      { min: 0 },
    ),
    sound_effects: expectBoolean(general.sound_effects, "Transfer file contains an invalid sound setting."),
    background_audio_mode: expectEnum(
      general.background_audio_mode,
      BACKGROUND_AUDIO_MODES,
      "Transfer file contains an invalid background audio mode.",
    ),
    background_audio_ducking_percent: expectInteger(
      general.background_audio_ducking_percent,
      "Transfer file contains an invalid background audio ducking percentage.",
      { min: 0, max: 100 },
    ),
    auto_pause_media: expectBoolean(
      general.auto_pause_media,
      "Transfer file contains an invalid media pause setting.",
    ),
    microphone_device: expectNullableString(
      general.microphone_device,
      "Transfer file contains an invalid microphone device.",
    )?.trim() || null,
    close_to_tray: expectBoolean(general.close_to_tray, "Transfer file contains an invalid tray setting."),
    start_minimized: expectBoolean(
      general.start_minimized,
      "Transfer file contains an invalid start minimized setting.",
    ),
  };
}

function parseVocabularyEntries(value: unknown, message: string): VocabularyEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }

  for (const entry of value) {
    const record = expectRecord(entry, message);
    expectString(record.text, message);
  }

  return normalizeVocabularyEntries(value);
}

function parsePromptConfig(value: unknown): PromptConfig {
  const prompt = expectRecord(value, "Transfer file contains invalid prompt settings.");

  return {
    system_prompt: expectString(
      prompt.system_prompt,
      "Transfer file contains an invalid system prompt.",
    ),
    user_instructions: expectString(
      prompt.user_instructions,
      "Transfer file contains invalid user instructions.",
    ),
    vocabulary: parseVocabularyEntries(
      prompt.vocabulary,
      "Transfer file contains an invalid vocabulary list.",
    ),
    context_clipboard: expectBoolean(
      prompt.context_clipboard,
      "Transfer file contains an invalid clipboard context setting.",
    ),
    context_selection: expectBoolean(
      prompt.context_selection,
      "Transfer file contains an invalid selection context setting.",
    ),
    context_active_app: expectBoolean(
      prompt.context_active_app,
      "Transfer file contains an invalid active-app context setting.",
    ),
    context_input_field: expectBoolean(
      prompt.context_input_field,
      "Transfer file contains an invalid input-field context setting.",
    ),
    context_screenshot: expectBoolean(
      prompt.context_screenshot,
      "Transfer file contains an invalid screenshot context setting.",
    ),
  };
}

function parseHistoryConfig(value: unknown): HistoryConfig {
  const history = expectRecord(value, "Transfer file contains invalid history settings.");

  return {
    retention_hours: expectInteger(
      history.retention_hours,
      "Transfer file contains an invalid history retention value.",
      { min: 0 },
    ),
    context_window_minutes: expectInteger(
      history.context_window_minutes,
      "Transfer file contains an invalid history context window.",
      { min: 0 },
    ),
  };
}

function parseSettingsTransferPayload(value: unknown): SettingsTransferPayload {
  const payload = expectRecord(value, "Transfer file is missing its settings payload.");
  const stt = expectRecord(payload.stt, "Transfer file contains invalid STT settings.");
  const llm = expectRecord(payload.llm, "Transfer file contains invalid LLM settings.");

  return {
    stt: {
      base_url: expectString(stt.base_url, "Transfer file contains an invalid STT base URL.").trim(),
      model: expectString(stt.model, "Transfer file contains an invalid STT model.").trim(),
      language: expectNullableString(stt.language, "Transfer file contains an invalid STT language.")?.trim() || null,
    },
    llm: {
      enabled: expectBoolean(llm.enabled, "Transfer file contains an invalid LLM enabled flag."),
      base_url: expectString(llm.base_url, "Transfer file contains an invalid LLM base URL.").trim(),
      model: expectString(llm.model, "Transfer file contains an invalid LLM model.").trim(),
    },
    general: parseGeneralConfig(payload.general),
    prompt: parsePromptConfig(payload.prompt),
    history: parseHistoryConfig(payload.history),
  };
}

function parseVocabularyTransferPayload(value: unknown): VocabularyTransferBundle["payload"] {
  const payload = expectRecord(value, "Transfer file is missing its vocabulary payload.");

  return {
    vocabulary: parseVocabularyEntries(
      payload.vocabulary,
      "Transfer file contains an invalid vocabulary list.",
    ),
  };
}

function basenameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function currentDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function createTransferFilename(kind: TransferKind): string {
  return kind === "settings"
    ? `YAT-settings-${currentDateStamp()}.json`
    : `YAT-vocabulary-${currentDateStamp()}.json`;
}

function createTransferFilters(kind: TransferKind) {
  return [
    {
      name: kind === "settings" ? "YAT settings" : "YAT vocabulary",
      extensions: ["json"],
    },
  ];
}

function downloadTextInBrowser(contents: string, filename: string): string {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

async function readFileTextInBrowser(): Promise<string | null> {
  if (typeof window !== "undefined" && "showOpenFilePicker" in window) {
    try {
      const handles = await (window as any).showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "JSON",
            accept: {
              "application/json": [".json"],
            },
          },
        ],
      });
      const file = await handles?.[0]?.getFile?.();
      return file ? await file.text() : null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  }

  return await new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);

    let settled = false;

    const cleanup = () => {
      input.value = "";
      input.remove();
    };

    const resolveOnce = (value: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (!input.files?.length) {
          resolveOnce(null);
        }
      }, 0);
    };

    window.addEventListener("focus", handleWindowFocus, { once: true });

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolveOnce(null);
        return;
      }

      try {
        const text = await file.text();
        resolveOnce(text);
      } catch (error) {
        rejectOnce(error);
      }
    }, { once: true });

    input.click();
  });
}

function uniqueReviewItems(items: SettingsImportReviewKey[]): SettingsImportReviewKey[] {
  return Array.from(new Set(items));
}

function isDefaultHotkeyForPlatform(
  hotkey: HotkeyConfig,
  platform: DesktopPlatform,
): boolean {
  const expected = createDefaultAppSettings(platform).general.hotkey;
  return (
    hotkey.hotkey_type === expected.hotkey_type
    && hotkey.key === expected.key
    && hotkey.double_tap_interval_ms === expected.double_tap_interval_ms
    && hotkey.held_keys.length === 0
  );
}

function buildTransferMetadata(sourcePlatform: DesktopPlatform): TransferMetadata {
  return {
    exportedAt: new Date().toISOString(),
    sourcePlatform,
  };
}

function parseTransferBundle(value: unknown): TransferBundle {
  const transfer = expectRecord(value, "Invalid transfer file.");

  if (transfer.app !== TRANSFER_APP) {
    throw new Error("This file was not generated by YAT.");
  }

  if (transfer.schemaVersion !== TRANSFER_SCHEMA_VERSION) {
    throw new Error("This transfer file version is not supported.");
  }

  if (transfer.kind !== "settings" && transfer.kind !== "vocabulary") {
    throw new Error("Unknown transfer file type.");
  }

  const metadata = parseTransferMetadata(transfer.metadata);

  if (transfer.kind === "settings") {
    const rawMetadata = expectRecord(
      transfer.metadata,
      "Transfer file is missing required metadata.",
    );

    if (rawMetadata.secretsIncluded !== false) {
      throw new Error("Settings backups must not include API keys.");
    }

    return {
      app: TRANSFER_APP,
      schemaVersion: TRANSFER_SCHEMA_VERSION,
      kind: "settings",
      metadata: {
        ...metadata,
        secretsIncluded: false,
      },
      payload: parseSettingsTransferPayload(transfer.payload),
    };
  }

  return {
    app: TRANSFER_APP,
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    kind: "vocabulary",
    metadata,
    payload: parseVocabularyTransferPayload(transfer.payload),
  };
}

export function buildSettingsTransferBundle(
  settings: AppSettings,
  sourcePlatform: DesktopPlatform,
): SettingsTransferBundle {
  const snapshot = cloneSettings(settings);

  return {
    app: TRANSFER_APP,
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    kind: "settings",
    metadata: {
      ...buildTransferMetadata(sourcePlatform),
      secretsIncluded: false,
    },
    payload: {
      stt: {
        base_url: snapshot.stt.base_url.trim(),
        model: snapshot.stt.model.trim(),
        language: snapshot.stt.language?.trim() || null,
      },
      llm: {
        enabled: snapshot.llm.enabled,
        base_url: snapshot.llm.base_url.trim(),
        model: snapshot.llm.model.trim(),
      },
      general: {
        ...snapshot.general,
        microphone_device: snapshot.general.microphone_device?.trim() || null,
      },
      prompt: {
        ...snapshot.prompt,
        vocabulary: normalizeVocabularyEntries(snapshot.prompt.vocabulary),
      },
      history: {
        ...snapshot.history,
      },
    },
  };
}

export function buildVocabularyTransferBundle(
  vocabulary: VocabularyEntry[],
  sourcePlatform: DesktopPlatform,
): VocabularyTransferBundle {
  return {
    app: TRANSFER_APP,
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    kind: "vocabulary",
    metadata: buildTransferMetadata(sourcePlatform),
    payload: {
      vocabulary: normalizeVocabularyEntries(vocabulary),
    },
  };
}

export async function saveTransferBundle(bundle: TransferBundle): Promise<string | null> {
  const filename = createTransferFilename(bundle.kind);
  const contents = JSON.stringify(bundle, null, 2);

  if (!isTauriRuntime()) {
    return downloadTextInBrowser(contents, filename);
  }

  const { save } = await import("@tauri-apps/plugin-dialog");
  const selectedPath = await save({
    defaultPath: filename,
    filters: createTransferFilters(bundle.kind),
    title: bundle.kind === "settings" ? "Export YAT settings" : "Export YAT vocabulary",
  });

  if (!selectedPath) {
    return null;
  }

  await invoke("write_transfer_file", { path: selectedPath, contents });
  return basenameFromPath(selectedPath);
}

export async function pickTransferBundle(): Promise<TransferBundle | null> {
  let contents: string | null = null;

  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: "YAT transfer", extensions: ["json"] }],
      title: "Import YAT transfer file",
    });

    if (!selectedPath || Array.isArray(selectedPath)) {
      return null;
    }

    contents = await invoke<string>("read_transfer_file", { path: selectedPath });
  } else {
    contents = await readFileTextInBrowser();
  }

  if (!contents) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("Transfer file is not valid JSON.");
  }

  return parseTransferBundle(parsed);
}

export function prepareImportedSettingsBundle(
  bundle: SettingsTransferBundle,
  currentSettings: AppSettings,
  currentPlatform: DesktopPlatform,
): SettingsImportPlan {
  const sourcePlatform = bundle.metadata.sourcePlatform ?? "unknown";
  const next = hydrateSettings({
    stt: {
      ...bundle.payload.stt,
      api_key: currentSettings.stt.api_key,
    },
    llm: {
      ...bundle.payload.llm,
      api_key: currentSettings.llm.api_key,
    },
    general: bundle.payload.general,
    prompt: {
      ...bundle.payload.prompt,
      vocabulary: normalizeVocabularyEntries(bundle.payload.prompt.vocabulary),
    },
    history: bundle.payload.history,
  }, currentPlatform);

  const reviewItems: SettingsImportReviewKey[] = ["api_keys_not_imported"];
  const crossPlatform = sourcePlatform !== "unknown"
    && currentPlatform !== "unknown"
    && sourcePlatform !== currentPlatform;

  if (crossPlatform) {
    if (next.general.microphone_device) {
      next.general.microphone_device = null;
      reviewItems.push("microphone_device_reset");
    }

    if (isDefaultHotkeyForPlatform(next.general.hotkey, sourcePlatform)) {
      next.general.hotkey = createDefaultAppSettings(currentPlatform).general.hotkey;
      reviewItems.push("hotkey_default_adjusted");
    } else {
      reviewItems.push("hotkey_review_recommended");
    }
  }

  const hotkeyValidationError = validateSettings(next);
  if (hotkeyValidationError) {
    next.general.hotkey = cloneSettings(currentSettings).general.hotkey;
    reviewItems.push("hotkey_preserved_current");
  }

  return {
    settings: next,
    sourcePlatform,
    reviewItems: uniqueReviewItems(reviewItems),
  };
}

export function prepareImportedVocabularyBundle(
  bundle: TransferBundle,
  currentSettings: AppSettings,
): VocabularyImportPlan {
  const sourcePlatform = bundle.metadata.sourcePlatform ?? "unknown";
  const importedVocabulary = normalizeVocabularyEntries(
    bundle.kind === "settings"
      ? bundle.payload.prompt.vocabulary
      : bundle.payload.vocabulary,
  );

  const existingKeys = new Set(
    currentSettings.prompt.vocabulary.map((entry) => entry.text.trim().toLowerCase()),
  );

  const merged = [...currentSettings.prompt.vocabulary];
  let addedCount = 0;

  for (const entry of importedVocabulary) {
    const key = entry.text.trim().toLowerCase();
    if (!key || existingKeys.has(key)) {
      continue;
    }

    merged.push({ text: entry.text });
    existingKeys.add(key);
    addedCount += 1;
  }

  return {
    vocabulary: normalizeVocabularyEntries(merged),
    sourcePlatform,
    importedCount: importedVocabulary.length,
    addedCount,
    skippedCount: Math.max(importedVocabulary.length - addedCount, 0),
  };
}

export function getAdjustedDefaultHotkeyLabel(platform: DesktopPlatform): string {
  return getDefaultHotkeyKeyForPlatform(platform);
}
