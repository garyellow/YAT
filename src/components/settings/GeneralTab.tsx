import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/appStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  browserCodeToRdevName,
  formatHotkeyKey,
  sortModifiersFirst,
  validateHotkeyConfig,
} from "../../lib/settingsFormatters";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import type { AppSettings } from "../../stores/settingsStore";
import {
  Notice,
  OptionCard,
  PageIntro,
  RangeField,
  Section,
  SettingList,
  SettingRow,
  StatusDot,
  SummaryPill,
} from "./SettingPrimitives";
import Toggle from "../ui/Toggle";
import ConfirmDialog from "../ui/ConfirmDialog";
import {
  buildSettingsTransferBundle,
  getAdjustedDefaultHotkeyLabel,
  pickTransferBundle,
  prepareImportedSettingsBundle,
  saveTransferBundle,
  type SettingsImportReviewKey,
  type SettingsTransferBundle,
} from "../../lib/settingsTransfer";

const HOTKEY_VALIDATION_COPY: Record<string, string> = {
  missing_key: "general.hotkeyValidationMissingKey",
  escape_reserved: "general.hotkeyValidationEscapeReserved",
  unsupported_key: "general.hotkeyValidationUnsupportedKey",
  missing_modifier: "general.hotkeyValidationMissingModifier",
  unsupported_modifier: "general.hotkeyValidationUnsupportedModifier",
  same_key_and_modifier: "general.hotkeyValidationSameKey",
  invalid_double_tap_interval: "general.hotkeyValidationDoubleTapRange",
};

function DisclosureButton({
  summary,
  open,
  onClick,
  controlsId,
  hint,
}: {
  summary: string;
  open: boolean;
  onClick: () => void;
  controlsId: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      className="btn btn-secondary btn-compact disclosure-btn"
      aria-expanded={open}
      aria-controls={controlsId}
      onClick={onClick}
      title={hint}
    >
      <span className="disclosure-btn-value">{summary}</span>
      <span
        className="disclosure-btn-chevron"
        style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        aria-hidden="true"
      >
        ▶
      </span>
    </button>
  );
}

function SystemActionCard({
  title,
  status,
  tone = "default",
  body,
  hint,
  actions,
}: {
  title: string;
  status?: string;
  tone?: "default" | "success" | "warning" | "danger";
  body: string;
  hint?: string | null;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-(--border) bg-(--bg-elevated) px-4 py-4 shadow-(--shadow-xs)">
      {status != null ? <StatusDot tone={tone}>{status}</StatusDot> : null}
      <h3 className="mt-3 text-[13.5px] font-semibold text-(--text)">{title}</h3>
      <p className="mt-1 text-xs leading-6 text-(--text-secondary)">{body}</p>
      {hint ? (
        <p className="mt-2 text-[11px] leading-5 text-(--text-muted)">{hint}</p>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Accessible radio-button group with keyboard roving (arrow keys). */
function RadioGroup<T extends string>({
  items,
  value,
  onChange,
  labelledBy,
  renderLabel,
}: {
  items: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labelledBy: string;
  renderLabel: (v: T) => string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const idx = items.indexOf(value);
    let next: number | null = null;

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (idx + 1) % items.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (idx - 1 + items.length) % items.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = items.length - 1;
    }

    if (next !== null) {
      e.preventDefault();
      onChange(items[next]);
      // Move focus to the newly selected radio button
      const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[next]?.focus();
    }
  };

  return (
    <div
      ref={groupRef}
      className="flex flex-wrap gap-1.5"
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="radio"
          aria-checked={value === item}
          tabIndex={value === item ? 0 : -1}
          className={`btn btn-compact ${value === item ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onChange(item)}
        >
          {renderLabel(item)}
        </button>
      ))}
    </div>
  );
}

interface GeneralTabProps {
  onToast?: (message: string, tone?: "success" | "error" | "info") => void;
}

export default function GeneralTab({ onToast }: GeneralTabProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const [showBackgroundAudio, setShowBackgroundAudio] = useState(false);
  const [showOutputOptions, setShowOutputOptions] = useState(false);
  const [pendingSettingsImport, setPendingSettingsImport] = useState<SettingsTransferBundle | null>(null);
  const [transferNotice, setTransferNotice] = useState<{
    tone: "success" | "warning" | "danger";
    title: string;
    lines?: string[];
  } | null>(null);
  const platform = useAppStore((s) => s.platform);
  const permissions = useAppStore((s) => s.permissions);
  const loadPermissions = useAppStore((s) => s.loadPermissions);
  const requestPermission = useAppStore((s) => s.requestPermission);
  const recordingRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setAudioDevices([]);
      return;
    }

    invoke<string[]>("list_audio_devices")
      .then(setAudioDevices)
      .catch((e) => console.error("Failed to list audio devices:", e));
  }, []);

  if (!settings) return null;

  const g = settings.general;
  const backgroundAudioRemaining = 100 - g.background_audio_ducking_percent;
  const statusAreaLabel = platform === "macos"
    ? t("general.statusAreaMacos")
    : t("general.statusAreaDefault");

  const update = (patch: Partial<AppSettings["general"]>) => {
    updateSettings({ general: { ...g, ...patch } });
  };

  const hotkeyValidation = validateHotkeyConfig(g.hotkey);

  const refreshDevices = () => {
    if (!isTauriRuntime()) {
      setAudioDevices([]);
      return;
    }

    invoke<string[]>("list_audio_devices")
      .then(setAudioDevices)
      .catch((e) => console.error("Failed to list audio devices:", e));
  };

  const recordHotkey = async () => {
    if (recordingRef.current) return;

    recordingRef.current = true;
    setRecording(true);
    setPressedKeys([]);

    try {
      await invoke("suspend_hotkey_triggers");
    } catch {
      // In browser/mock mode this may fail; recording can still proceed locally.
    }

    try {
      const result = await new Promise<AppSettings["general"]["hotkey"]>((resolve, reject) => {
        const HOLD_THRESHOLD_MS = 400;
        const DOUBLE_TAP_WINDOW_MS = 400;

        const held = new Map<string, number>();
        const sequence: Array<{ key: string; at: number }> = [];
        let sawCombo = false;
        let firstTap: { key: string; releasedAt: number } | null = null;
        let pendingSingleTimer: number | null = null;

        const clearPendingSingleTimer = () => {
          if (pendingSingleTimer !== null) {
            window.clearTimeout(pendingSingleTimer);
            pendingSingleTimer = null;
          }
        };

        const finalize = (value: AppSettings["general"]["hotkey"]) => {
          clearPendingSingleTimer();
          cleanup();
          resolve(value);
        };

        const cancel = () => {
          clearPendingSingleTimer();
          cleanup();
          reject(new Error("cancelled"));
        };

        const buildCombo = () => {
          const orderedUnique = sequence.filter(
            (entry, index, arr) => arr.findIndex((x) => x.key === entry.key) === index,
          );
          if (orderedUnique.length < 2) return null;

          const key = orderedUnique[orderedUnique.length - 1]?.key;
          const heldKeys = orderedUnique.slice(0, -1).map((entry) => entry.key);
          if (heldKeys.length === 0 || !key) return null;

          return {
            hotkey_type: "combo" as const,
            key,
            held_keys: heldKeys,
            double_tap_interval_ms: 300,
          };
        };

        const onKeyDown = (e: KeyboardEvent) => {
          if (!recordingRef.current) return;

          const mapped = browserCodeToRdevName(e.code);
          if (!mapped) return;

          e.preventDefault();
          e.stopPropagation();

          if (mapped === "Escape") {
            cancel();
            return;
          }

          const now = performance.now();

          if (firstTap && firstTap.key === mapped && now - firstTap.releasedAt < DOUBLE_TAP_WINDOW_MS) {
            finalize({
              hotkey_type: "double_tap",
              key: mapped,
              held_keys: [],
              double_tap_interval_ms: Math.round(now - firstTap.releasedAt) + 100,
            });
            return;
          }

          if (!held.has(mapped)) {
            held.set(mapped, now);
            sequence.push({ key: mapped, at: now });
          }

          if (held.size >= 2) {
            sawCombo = true;
          }

          setPressedKeys(sortModifiersFirst(Array.from(held.keys())));
        };

        const onKeyUp = (e: KeyboardEvent) => {
          if (!recordingRef.current) return;

          const mapped = browserCodeToRdevName(e.code);
          if (!mapped) return;

          e.preventDefault();
          e.stopPropagation();

          const pressAt = held.get(mapped);
          if (pressAt === undefined) return;

          const now = performance.now();
          const duration = now - pressAt;

          held.delete(mapped);
          setPressedKeys(sortModifiersFirst(Array.from(held.keys())));

          if (sawCombo) {
            if (held.size === 0) {
              const combo = buildCombo();
              if (combo) {
                finalize(combo);
              } else {
                cancel();
              }
            }
            return;
          }

          if (duration >= HOLD_THRESHOLD_MS) {
            finalize({
              hotkey_type: "hold",
              key: mapped,
              held_keys: [],
              double_tap_interval_ms: 300,
            });
            return;
          }

          if (!firstTap) {
            firstTap = { key: mapped, releasedAt: now };
            clearPendingSingleTimer();
            pendingSingleTimer = window.setTimeout(() => {
              finalize({
                hotkey_type: "single",
                key: firstTap?.key ?? mapped,
                held_keys: [],
                double_tap_interval_ms: 300,
              });
            }, DOUBLE_TAP_WINDOW_MS + 50);
          }
        };

        const timeoutId = window.setTimeout(() => {
          clearPendingSingleTimer();
          cleanup();
          reject(new Error("timeout"));
        }, 10000);

        const cleanup = () => {
          window.clearTimeout(timeoutId);
          window.removeEventListener("keydown", onKeyDown, true);
          window.removeEventListener("keyup", onKeyUp, true);
        };

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
      });

      update({ hotkey: result });
    } catch {
      // timeout or cancel
    } finally {
      try {
        await invoke("resume_hotkey_triggers");
      } catch {
        // In browser/mock mode this may fail; ignore.
      }
      recordingRef.current = false;
      setRecording(false);
      setPressedKeys([]);
    }
  };

  const modeLabel = (type: string) => {
    switch (type) {
      case "hold": return t("general.hold");
      case "combo": return t("general.combo");
      case "double_tap": return t("general.doubleTap");
      case "single": return t("general.single");
      default: return type;
    }
  };

  const currentHotkeySequence = g.hotkey.hotkey_type === "combo"
    ? [...g.hotkey.held_keys, g.hotkey.key]
    : [g.hotkey.key];

  const backgroundAudioSummary = g.background_audio_mode === "off"
    ? t("general.backgroundAudioOff")
    : g.background_audio_mode === "mute"
      ? t("general.backgroundAudioMute")
      : `${t("general.backgroundAudioDuck")} · ${g.background_audio_ducking_percent}%`;

  const outputSummary = g.output_mode === "auto_paste"
    ? g.clipboard_behavior === "always"
      ? `${t("general.autoPaste")} · ${t("general.alwaysCopyToggle")}`
      : t("general.autoPaste")
    : t("general.clipboardOnly");

  const autoPauseMediaDetail = platform === "macos"
    ? t("general.autoPauseMediaDetailMacos")
    : platform === "linux"
      ? t("general.autoPauseMediaDetailLinux")
      : null;

  const openSystemUrl = async (url: string) => {
    if (!isTauriRuntime()) return;

    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (error) {
      console.error("Failed to open system settings:", error);
      onToast?.(t("general.systemSettingsOpenFailed"), "error");
    }
  };

  const requestSystemPermission = async (category: string) => {
    try {
      await requestPermission(category);
      await loadPermissions();
    } catch (error) {
      console.error("Failed to request permission:", error);
      onToast?.(t("general.permissionRequestFailed"), "error");
    }
  };

  const reviewLine = (item: SettingsImportReviewKey): string => {
    switch (item) {
      case "api_keys_not_imported":
        return t("general.transferReviewApiKeys");
      case "microphone_device_reset":
        return t("general.transferReviewMicrophoneReset");
      case "hotkey_default_adjusted":
        return t("general.transferReviewHotkeyAdjusted", {
          hotkey: formatHotkeyKey(getAdjustedDefaultHotkeyLabel(platform)),
        });
      case "hotkey_review_recommended":
        return t("general.transferReviewHotkeyCheck");
      case "hotkey_preserved_current":
        return t("general.transferReviewHotkeyKept");
      default:
        return item;
    }
  };

  const handleExportSettings = async () => {
    try {
      const savedAs = await saveTransferBundle(buildSettingsTransferBundle(settings, platform));
      if (!savedAs) {
        return;
      }

      setTransferNotice({
        tone: "success",
        title: t("general.transferExportedTitle"),
        lines: [t("general.transferExportedBody")],
      });
      onToast?.(t("general.transferExportedToast", { file: savedAs }), "success");
    } catch (error) {
      console.error("Failed to export settings:", error);
      const message = error instanceof Error ? error.message : String(error);
      setTransferNotice({
        tone: "danger",
        title: t("general.transferFailedTitle"),
        lines: [message],
      });
      onToast?.(t("general.transferFailedTitle"), "error");
    }
  };

  const handleImportSettings = async () => {
    try {
      const bundle = await pickTransferBundle();
      if (!bundle) {
        return;
      }

      if (bundle.kind !== "settings") {
        throw new Error(t("general.transferInvalidSettingsFile"));
      }

      setPendingSettingsImport(bundle);
    } catch (error) {
      console.error("Failed to import settings:", error);
      const message = error instanceof Error ? error.message : String(error);
      setTransferNotice({
        tone: "danger",
        title: t("general.transferFailedTitle"),
        lines: [message],
      });
      onToast?.(message, "error");
    }
  };

  const confirmImportSettings = async () => {
    if (!pendingSettingsImport) {
      return;
    }

    try {
      const plan = prepareImportedSettingsBundle(pendingSettingsImport, settings, platform);
      await saveSettings(plan.settings);
      setPendingSettingsImport(null);

      const reviewItems = plan.reviewItems.map(reviewLine);
      setTransferNotice({
        tone: reviewItems.length > 1 ? "warning" : "success",
        title: t("general.transferImportedTitle"),
        lines: reviewItems,
      });
      onToast?.(t("general.transferImportedToast"), "success");
    } catch (error) {
      console.error("Failed to apply imported settings:", error);
      const message = error instanceof Error ? error.message : String(error);
      setTransferNotice({
        tone: "danger",
        title: t("general.transferFailedTitle"),
        lines: [message],
      });
      onToast?.(message, "error");
      setPendingSettingsImport(null);
    }
  };

  const backgroundAudioStatus = (() => {
    if (g.background_audio_mode === "off") {
      return {
        tone: "default" as const,
        status: t("general.systemStatusOff"),
        body: t("general.systemBackgroundAudioOffBody"),
        hint: null,
      };
    }

    if (platform === "linux" && permissions?.pactl_available === false) {
      return {
        tone: "danger" as const,
        status: t("general.systemStatusNeedsTool"),
        body: t("general.systemBackgroundAudioNeedsPactlBody"),
        hint: t("general.systemBackgroundAudioNeedsPactlHint"),
      };
    }

    const mode = g.background_audio_mode === "duck"
      ? t("general.backgroundAudioDuck")
      : t("general.backgroundAudioMute");

    return {
      tone: "success" as const,
      status: t("general.systemStatusReady"),
      body: t("general.systemBackgroundAudioReadyBody", { mode }),
      hint: platform === "linux" ? t("general.systemBackgroundAudioLinuxHint") : null,
    };
  })();

  const pauseMediaStatus = (() => {
    if (!g.auto_pause_media) {
      return {
        tone: "default" as const,
        status: t("general.systemStatusOff"),
        body: t("general.systemPauseMediaOffBody"),
        hint: null,
        actions: null as React.ReactNode,
      };
    }

    if (platform === "linux" && permissions?.playerctl_available === false) {
      return {
        tone: "danger" as const,
        status: t("general.systemStatusNeedsTool"),
        body: t("general.systemPauseMediaNeedsPlayerctlBody"),
        hint: t("general.systemPauseMediaNeedsPlayerctlHint"),
        actions: null as React.ReactNode,
      };
    }

    if (platform === "macos" && permissions?.accessibility !== "granted") {
      return {
        tone: "warning" as const,
        status: t("general.systemStatusNeedsPermission"),
        body: t("general.systemPauseMediaNeedsAccessibilityBody"),
        hint: t("general.systemPauseMediaNeedsAccessibilityHint"),
        actions: (
          <>
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={() => void requestSystemPermission("accessibility")}
            >
              {t("overview.permissions.requestPermission")}
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => void openSystemUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")}
            >
              {t("overview.permissions.openAccessibilitySettings")}
            </button>
          </>
        ),
      };
    }

    if (platform === "windows") {
      return {
        tone: "success" as const,
        status: t("general.systemStatusReady"),
        body: t("general.systemPauseMediaWindowsReadyBody"),
        hint: null,
        actions: null as React.ReactNode,
      };
    }

    if (platform === "macos") {
      return {
        tone: "success" as const,
        status: t("general.systemStatusReady"),
        body: t("general.systemPauseMediaMacosReadyBody"),
        hint: null,
        actions: null as React.ReactNode,
      };
    }

    return {
      tone: "success" as const,
      status: t("general.systemStatusReady"),
      body: t("general.systemPauseMediaLinuxReadyBody"),
      hint: t("general.systemPauseMediaLinuxReadyHint"),
      actions: null as React.ReactNode,
    };
  })();

  const autoPasteStatus = (() => {
    if (g.output_mode === "clipboard_only") {
      return {
        tone: "default" as const,
        status: t("general.systemStatusOff"),
        body: t("general.systemAutoPasteClipboardBody"),
        hint: null,
        actions: null as React.ReactNode,
      };
    }

    if (platform === "macos" && permissions?.accessibility !== "granted") {
      return {
        tone: "warning" as const,
        status: t("general.systemStatusNeedsPermission"),
        body: t("general.systemAutoPasteNeedsAccessibilityBody"),
        hint: t("general.systemAutoPasteNeedsAccessibilityHint"),
        actions: (
          <>
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={() => void requestSystemPermission("accessibility")}
            >
              {t("overview.permissions.requestPermission")}
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              onClick={() => void openSystemUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")}
            >
              {t("overview.permissions.openAccessibilitySettings")}
            </button>
          </>
        ),
      };
    }

    if (platform === "windows") {
      return {
        tone: "warning" as const,
        status: t("general.systemStatusLimited"),
        body: t("general.systemAutoPasteWindowsLimitedBody"),
        hint: t("general.systemAutoPasteWindowsLimitedHint"),
        actions: null as React.ReactNode,
      };
    }

    if (platform === "linux") {
      return {
        tone: "warning" as const,
        status: t("general.systemStatusExperimental"),
        body: t("general.systemAutoPasteLinuxExperimentalBody"),
        hint: t("general.systemAutoPasteLinuxExperimentalHint"),
        actions: null as React.ReactNode,
      };
    }

    return {
      tone: "success" as const,
      status: t("general.systemStatusReady"),
      body: t("general.systemAutoPasteReadyBody"),
      hint: null,
      actions: null as React.ReactNode,
    };
  })();

  const renderKeySequence = (keys: string[], subtle = false) => (
    <div className="flex min-h-10 flex-wrap items-center gap-2">
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 ? <span className="text-xs text-(--text-muted)">+</span> : null}
          <kbd
            className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              subtle
                ? "border-(--border) bg-(--bg-muted) text-(--text)"
                : "border-(--border) bg-(--bg-elevated) text-(--text)"
            }`}
          >
            {formatHotkeyKey(key)}
          </kbd>
        </Fragment>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow={t("settings.groups.capture")}
        title={t("tabs.general")}
        description={`${t("general.recordingDesc")} ${t("general.outputDesc")}`}
      />

      <Section title={t("general.hotkey")} description={t("general.hotkeyDesc")}>
        <SettingList>
          <SettingRow
            label={t("general.currentHotkey")}
            control={
              <div className="flex flex-wrap items-center gap-2">
                {renderKeySequence(currentHotkeySequence)}
                <SummaryPill tone="accent">{modeLabel(g.hotkey.hotkey_type)}</SummaryPill>
                <button
                  type="button"
                  className={`btn btn-compact shrink-0 ${recording ? "btn-primary animate-pulse" : "btn-secondary"}`}
                  onClick={recordHotkey}
                  disabled={recording}
                  title={recording ? t("general.recordingHotkeyBody") : t("general.hotkeyDesc")}
                >
                  {recording ? t("general.recordingHotkey") : t("general.recordHotkey")}
                </button>
              </div>
            }
          >

            {recording ? (
              <div className="rounded-xl border border-(--accent) bg-(--accent-subtle) px-4 py-3">
                <p className="text-[13px] font-semibold text-(--text)">
                  {t("general.recordingHotkeyTitle")}
                </p>
                <p className="mt-1 text-xs leading-6 text-(--text-secondary)">
                  {t("general.recordingHotkeyBody")}
                </p>
                <div className="mt-3 rounded-lg border border-dashed border-(--border) bg-(--bg-elevated) px-3 py-3">
                  {pressedKeys.length > 0 ? (
                    renderKeySequence(pressedKeys, true)
                  ) : (
                    <span className="text-xs text-(--text-muted)">
                      {t("general.recordingWaitingKeys")}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </SettingRow>
        </SettingList>

        {hotkeyValidation ? (
          <div className="mt-4">
            <Notice title={t("general.hotkeyValidationTitle")} tone="danger">
              {t(HOTKEY_VALIDATION_COPY[hotkeyValidation.code])}
            </Notice>
          </div>
        ) : null}
      </Section>

      <Section title={t("general.sectionRecording")} description={t("general.recordingDesc")}>
        <SettingList>
          <SettingRow
            labelId="microphone-device-label"
            label={t("general.microphoneDevice")}
            description={t("general.microphoneHint")}
            control={
              <button
                type="button"
                onClick={refreshDevices}
                className="btn btn-ghost btn-compact text-xs"
                title={t("general.microphoneHint")}
              >
                {t("general.refreshDevices")}
              </button>
            }
          >
            <div className="w-full">
              <select
                id="microphone-device"
                name="microphone-device"
                aria-labelledby="microphone-device-label"
                value={g.microphone_device ?? ""}
                onChange={(e) => update({ microphone_device: e.target.value || null })}
                className="field-select"
              >
                <option value="">{t("general.defaultDevice")}</option>
                {audioDevices.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </SettingRow>

          <SettingRow
            labelId="max-recording-label"
            label={t("general.maxRecording")}
            description={t("general.maxRecordingHint")}
          >
            <div className="w-full">
              <RangeField
                id="max-recording"
                name="max-recording"
                aria-labelledby="max-recording-label"
                value={g.max_recording_seconds}
                onChange={(value) => update({ max_recording_seconds: value })}
                min={10}
                max={600}
                step={10}
                formatValue={(value) => `${value}${t("general.seconds")}`}
              />
            </div>
          </SettingRow>

          <SettingRow
            labelId="sound-effects-label"
            label={t("general.soundEffects")}
            description={t("general.soundEffectsHint")}
            control={
              <Toggle
                checked={g.sound_effects}
                onChange={(v) => update({ sound_effects: v })}
                ariaLabelledBy="sound-effects-label"
              />
            }
          />

          <SettingRow
            label={t("general.backgroundAudio")}
            description={t("general.backgroundAudioHint")}
            control={
              <DisclosureButton
                summary={backgroundAudioSummary}
                open={showBackgroundAudio}
                controlsId="background-audio-panel"
                hint={t("general.backgroundAudioHint")}
                onClick={() => setShowBackgroundAudio((value) => !value)}
              />
            }
          >
            {showBackgroundAudio ? (
              <div id="background-audio-panel" className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <OptionCard
                    title={t("general.backgroundAudioOff")}
                    description={t("general.backgroundAudioOffDesc")}
                    selected={g.background_audio_mode === "off"}
                    onClick={() => update({ background_audio_mode: "off" })}
                  />
                  <OptionCard
                    title={t("general.backgroundAudioDuck")}
                    description={t("general.backgroundAudioDuckDesc")}
                    selected={g.background_audio_mode === "duck"}
                    onClick={() => update({ background_audio_mode: "duck" })}
                  />
                  <OptionCard
                    title={t("general.backgroundAudioMute")}
                    description={t("general.backgroundAudioMuteDesc")}
                    selected={g.background_audio_mode === "mute"}
                    onClick={() => update({ background_audio_mode: "mute" })}
                  />
                </div>

                {g.background_audio_mode === "duck" ? (
                  <SettingRow
                    inset
                    labelId="background-audio-ducking-percent-label"
                    label={t("general.backgroundAudioDuckAmount")}
                    description={t("general.backgroundAudioDuckAmountBody", {
                      percent: g.background_audio_ducking_percent,
                      remaining: backgroundAudioRemaining,
                    })}
                  >
                    <div className="w-full">
                      <RangeField
                        id="background-audio-ducking-percent"
                        name="background-audio-ducking-percent"
                        aria-labelledby="background-audio-ducking-percent-label"
                        value={g.background_audio_ducking_percent}
                        onChange={(value) => update({ background_audio_ducking_percent: value })}
                        min={20}
                        max={90}
                        step={5}
                        formatValue={(value) => `${value}%`}
                      />
                    </div>
                  </SettingRow>
                ) : null}
              </div>
            ) : null}
          </SettingRow>

          <SettingRow
            labelId="auto-pause-media-label"
            label={t("general.autoPauseMedia")}
            description={t("general.autoPauseMediaHint")}
            hint={autoPauseMediaDetail ?? undefined}
            control={
              <Toggle
                checked={g.auto_pause_media}
                onChange={(v) => update({ auto_pause_media: v })}
                ariaLabelledBy="auto-pause-media-label"
              />
            }
          />
        </SettingList>

        <div className="mt-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[13.5px] font-semibold text-(--text)">{t("general.systemControlsTitle")}</h3>
              <p className="mt-1 text-xs leading-6 text-(--text-secondary)">{t("general.systemControlsDesc")}</p>
            </div>
            {isTauriRuntime() ? (
              <button
                type="button"
                className="btn btn-secondary btn-compact text-xs"
                onClick={() => void loadPermissions()}
              >
                {t("overview.permissions.refreshPermissions")}
              </button>
            ) : null}
          </div>

          {platform === "linux" ? (
            <Notice title={t("general.linuxExperimentalTitle")} tone="warning">
              {t("general.linuxExperimentalBody")}
            </Notice>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-2">
            <SystemActionCard
              title={t("general.systemBackgroundAudioTitle")}
              status={backgroundAudioStatus.status}
              tone={backgroundAudioStatus.tone}
              body={backgroundAudioStatus.body}
              hint={backgroundAudioStatus.hint}
            />
            <SystemActionCard
              title={t("general.systemPauseMediaTitle")}
              status={pauseMediaStatus.status}
              tone={pauseMediaStatus.tone}
              body={pauseMediaStatus.body}
              hint={pauseMediaStatus.hint}
              actions={pauseMediaStatus.actions}
            />
          </div>
        </div>
      </Section>

      <Section title={t("general.sectionOutput")} description={t("general.outputDesc")}>
        <SettingList>
          <SettingRow
            label={t("general.outputMode")}
            control={
              <DisclosureButton
                summary={outputSummary}
                open={showOutputOptions}
                controlsId="output-options-panel"
                hint={t("general.outputDesc")}
                onClick={() => setShowOutputOptions((value) => !value)}
              />
            }
          >
            {showOutputOptions ? (
              <div id="output-options-panel" className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <OptionCard
                    title={t("general.autoPaste")}
                    description={t("general.autoPasteDesc")}
                    selected={g.output_mode === "auto_paste"}
                    onClick={() => update({ output_mode: "auto_paste" })}
                  />
                  <OptionCard
                    title={t("general.clipboardOnly")}
                    description={t("general.clipboardOnlyDesc")}
                    selected={g.output_mode === "clipboard_only"}
                    onClick={() => update({ output_mode: "clipboard_only" })}
                  />
                </div>

                {g.output_mode === "auto_paste" ? (
                  <SettingRow
                    inset
                    labelId="clipboard-behavior-label"
                    label={t("general.alwaysCopyToggle")}
                    description={t("general.alwaysCopyToggleHint")}
                    control={
                      <Toggle
                        checked={g.clipboard_behavior === "always"}
                        onChange={(v) => update({ clipboard_behavior: v ? "always" : "only_on_paste_fail" })}
                        ariaLabelledBy="clipboard-behavior-label"
                      />
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </SettingRow>
        </SettingList>

        <div className="mt-5">
          <SystemActionCard
            title={t("general.systemAutoPasteTitle")}
            status={autoPasteStatus.status}
            tone={autoPasteStatus.tone}
            body={autoPasteStatus.body}
            hint={autoPasteStatus.hint}
            actions={autoPasteStatus.actions}
          />
        </div>
      </Section>

      <Section title={t("general.sectionAppearance")} description={t("general.appearanceDesc")}>
        <SettingList>
          <SettingRow
            labelId="appearance-theme-label"
            label={t("general.theme")}
            control={
              <RadioGroup
                items={["system", "light", "dark"] as const}
                value={g.theme}
                onChange={(v) => update({ theme: v })}
                labelledBy="appearance-theme-label"
                renderLabel={(v) => t(`general.${v}`)}
              />
            }
          />

          <SettingRow
            labelId="appearance-language-label"
            label={t("general.language")}
            control={
              <RadioGroup
                items={["zh-TW", "en"] as const}
                value={g.language === "en" ? "en" : "zh-TW"}
                onChange={(v) => update({ language: v as AppSettings["general"]["language"] })}
                labelledBy="appearance-language-label"
                renderLabel={(v) => v === "zh-TW" ? t("general.languageTraditionalChinese") : t("general.languageEnglish")}
              />
            }
          />
        </SettingList>
      </Section>

      <Section title={t("general.sectionWindow")} description={t("general.windowBehaviorDesc")}>
        <div className="space-y-4">
          <SettingList>
            <SettingRow
              labelId="close-to-tray-label"
              label={t("general.closeToTray")}
              description={t("general.closeToTrayHint", { place: statusAreaLabel })}
              control={
                <Toggle
                  checked={g.close_to_tray}
                  onChange={(v) => update({ close_to_tray: v })}
                  ariaLabelledBy="close-to-tray-label"
                />
              }
            />

            <SettingRow
              labelId="auto-start-label"
              label={t("general.autoStart")}
              description={t("general.autoStartHint")}
              control={
                <Toggle
                  checked={g.auto_start}
                  onChange={(v) => update({ auto_start: v })}
                  ariaLabelledBy="auto-start-label"
                />
              }
            >
              {g.auto_start ? (
                <SettingRow
                  inset
                  labelId="start-minimized-label"
                  label={t("general.startMinimized")}
                  description={t("general.startMinimizedHint", { place: statusAreaLabel })}
                  control={
                    <Toggle
                      checked={g.start_minimized}
                      onChange={(v) => update({ start_minimized: v })}
                      ariaLabelledBy="start-minimized-label"
                    />
                  }
                />
              ) : null}
            </SettingRow>
          </SettingList>
        </div>
      </Section>

      <Section title={t("general.sectionNetwork")} description={t("general.networkDesc")}>
        <SettingList>
          <SettingRow
            labelId="timeout-ms-label"
            label={t("general.timeout")}
            description={t("general.timeoutHint")}
          >
            <div className="w-full">
              <RangeField
                id="timeout-ms"
                name="timeout-ms"
                aria-labelledby="timeout-ms-label"
                value={g.timeout_ms}
                onChange={(value) => update({ timeout_ms: value })}
                min={5000}
                max={120000}
                step={1000}
                formatValue={(value) => `${value / 1000}s`}
              />
            </div>
          </SettingRow>

          <SettingRow
            labelId="max-retries-label"
            label={t("general.maxRetries")}
            description={t("general.maxRetriesHint")}
          >
            <div className="w-full">
              <RangeField
                id="max-retries"
                name="max-retries"
                aria-labelledby="max-retries-label"
                value={g.max_retries}
                onChange={(value) => update({ max_retries: value })}
                min={0}
                max={5}
                step={1}
                formatValue={(value) => value}
              />
            </div>
          </SettingRow>
        </SettingList>
      </Section>

      <Section
        title={t("general.transferTitle")}
        description={t("general.transferDesc")}
        aside={<SummaryPill tone="accent">{t("general.transferBadge")}</SummaryPill>}
      >
        <div className="space-y-4">
          <Notice title={t("general.transferNoticeTitle")} tone="default">
            <div className="space-y-2">
              <p>{t("general.transferNoticeApiKeys")}</p>
              <p>{t("general.transferNoticeCrossPlatform")}</p>
            </div>
          </Notice>

          <div className="grid gap-3 xl:grid-cols-2">
            <SystemActionCard
              title={t("general.transferExportCardTitle")}
              body={t("general.transferExportCardBody")}
              actions={
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  onClick={() => void handleExportSettings()}
                >
                  {t("general.transferExportAction")}
                </button>
              }
            />
            <SystemActionCard
              title={t("general.transferImportCardTitle")}
              body={t("general.transferImportCardBody")}
              actions={
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => void handleImportSettings()}
                >
                  {t("general.transferImportAction")}
                </button>
              }
            />
          </div>

          {transferNotice ? (
            <Notice title={transferNotice.title} tone={transferNotice.tone}>
              {transferNotice.lines?.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {transferNotice.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          ) : null}
        </div>
      </Section>

      <ConfirmDialog
        open={pendingSettingsImport !== null}
        title={t("general.transferImportConfirmTitle")}
        message={t("general.transferImportConfirmBody")}
        onConfirm={() => {
          void confirmImportSettings();
        }}
        onCancel={() => setPendingSettingsImport(null)}
      />
    </div>
  );
}
