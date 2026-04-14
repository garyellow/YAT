import { Fragment, useEffect, useRef, useState } from "react";
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
  SummaryPill,
} from "./SettingPrimitives";
import Toggle from "../ui/Toggle";

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

export default function GeneralTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const [showBackgroundAudio, setShowBackgroundAudio] = useState(false);
  const [showOutputOptions, setShowOutputOptions] = useState(false);
  const platform = useAppStore((s) => s.platform);
  const permissions = useAppStore((s) => s.permissions);
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

  const renderKeySequence = (keys: string[], subtle = false) => (
    <div className="flex min-h-10 flex-wrap items-center gap-2">
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          {index > 0 ? <span className="text-xs text-[var(--text-muted)]">+</span> : null}
          <kbd
            className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              subtle
                ? "border-[var(--border)] bg-[var(--bg-muted)] text-[var(--text)]"
                : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)]"
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
              <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-subtle)] px-4 py-3">
                <p className="text-[13px] font-semibold text-[var(--text)]">
                  {t("general.recordingHotkeyTitle")}
                </p>
                <p className="mt-1 text-xs leading-6 text-[var(--text-secondary)]">
                  {t("general.recordingHotkeyBody")}
                </p>
                <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-3">
                  {pressedKeys.length > 0 ? (
                    renderKeySequence(pressedKeys, true)
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">
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

        <div className="mt-4 space-y-3 empty:hidden">
          {g.background_audio_mode !== "off" && platform === "linux" && permissions?.pactl_available === false ? (
            <Notice title={t("general.backgroundAudioPactlMissing")} tone="danger">
              {t("general.backgroundAudioPactlMissingBody")}
            </Notice>
          ) : null}

          {g.auto_pause_media && platform === "linux" && permissions?.playerctl_available === false ? (
            <Notice title={t("general.autoPausePlayerctlMissing")} tone="danger">
              {t("general.autoPausePlayerctlMissingBody")}
            </Notice>
          ) : null}

          {g.auto_pause_media && platform === "macos" && permissions?.accessibility !== "granted" ? (
            <Notice title={t("general.autoPauseAccessibilityRequired")} tone="warning">
              {t("general.autoPauseAccessibilityRequiredBody")}
            </Notice>
          ) : null}
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

        {g.output_mode === "auto_paste" && platform === "macos" && permissions?.accessibility !== "granted" ? (
          <div className="mt-4">
            <Notice title={t("general.autoPasteAccessibilityRequired")} tone="warning">
              {t("general.autoPasteAccessibilityRequiredBody")}
            </Notice>
          </div>
        ) : null}
      </Section>

      <Section title={t("general.sectionAppearance")} description={t("general.appearanceDesc")}>
        <SettingList>
          <SettingRow
            labelId="appearance-theme-label"
            label={t("general.theme")}
            control={
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="appearance-theme-label">
                {(["system", "light", "dark"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={g.theme === value}
                    className={`btn btn-compact ${
                      g.theme === value ? "btn-primary" : "btn-ghost"
                    }`}
                    onClick={() => update({ theme: value })}
                  >
                    {t(`general.${value}`)}
                  </button>
                ))}
              </div>
            }
          />

          <SettingRow
            labelId="appearance-language-label"
            label={t("general.language")}
            control={
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="appearance-language-label">
                {(["zh-TW", "en"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={g.language === value}
                    className={`btn btn-compact ${
                      g.language === value ? "btn-primary" : "btn-ghost"
                    }`}
                    onClick={() => update({ language: value as AppSettings["general"]["language"] })}
                  >
                    {value === "zh-TW" ? t("general.languageTraditionalChinese") : t("general.languageEnglish")}
                  </button>
                ))}
              </div>
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
    </div>
  );
}
