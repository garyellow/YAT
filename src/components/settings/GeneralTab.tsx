import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/appStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  browserCodeToRdevName,
  formatHotkeyCombo,
  formatHotkeyKey,
  getHotkeyAdvice,
  getRecommendedHotkeyLabel,
  sortModifiersFirst,
  validateHotkeyConfig,
} from "../../lib/settingsFormatters";
import type { AppSettings } from "../../stores/settingsStore";
import { Notice, OptionCard, Section, StatusDot } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

const HOTKEY_VALIDATION_COPY: Record<string, string> = {
  missing_key: "general.hotkeyValidationMissingKey",
  escape_reserved: "general.hotkeyValidationEscapeReserved",
  unsupported_key: "general.hotkeyValidationUnsupportedKey",
  missing_modifier: "general.hotkeyValidationMissingModifier",
  unsupported_modifier: "general.hotkeyValidationUnsupportedModifier",
  same_key_and_modifier: "general.hotkeyValidationSameKey",
  invalid_double_tap_interval: "general.hotkeyValidationDoubleTapRange",
};

export default function GeneralTab() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const platform = useAppStore((s) => s.platform);
  const recordingRef = useRef(false);

  useEffect(() => {
    invoke<string[]>("list_audio_devices")
      .then(setAudioDevices)
      .catch((e) => console.error("Failed to list audio devices:", e));
  }, []);

  if (!settings) return null;

  const g = settings.general;
  const recommendedKeyToken = platform === "macos" ? "RCmd" : "RCtrl";

  const update = (patch: Partial<AppSettings["general"]>) => {
    updateSettings({ general: { ...g, ...patch } });
  };

  const hotkeySummary = formatHotkeyCombo(g.hotkey);
  const hotkeyAdvice = getHotkeyAdvice(g.hotkey);
  const hotkeyValidation = validateHotkeyConfig(g.hotkey);
  const recommendedHoldKey = getRecommendedHotkeyLabel(platform);
  const isRecommendedHotkey =
    g.hotkey.hotkey_type === "hold" &&
    g.hotkey.key.trim().toLowerCase() === recommendedKeyToken.toLowerCase();
  const hotkeyKeySuggestions =
    platform === "macos"
      ? ["RCmd", "Cmd", "Ctrl", "Alt", "F8", "Space", "A"]
      : ["RCtrl", "Ctrl", "Alt", "F8", "Space", "A"];
  const hotkeyModifierSuggestions =
    platform === "macos"
      ? ["Cmd", "Ctrl", "Alt", "Shift"]
      : ["Ctrl", "Alt", "Shift", "Cmd"];

  const refreshDevices = () => {
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

          const modifier = orderedUnique[0]?.key ?? null;
          const key = orderedUnique[orderedUnique.length - 1]?.key;
          if (!modifier || !key) return null;

          return {
            hotkey_type: "combo" as const,
            key,
            modifier,
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
              modifier: null,
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
              modifier: null,
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
                modifier: null,
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

  const platformNote =
    platform === "macos"
      ? t("general.platformHelpMac")
      : platform === "windows"
        ? t("general.platformHelpWindows")
        : platform === "linux"
          ? t("general.platformHelpLinux")
          : t("general.platformHelpUnknown");

  return (
    <div className="space-y-10">
      <Notice title={t("general.quickStartTitle")} tone="accent">
        {t("general.quickStartDesc", { hotkey: hotkeySummary })}
      </Notice>

      {/* Hotkey */}
      <Section
        title={t("general.hotkey")}
        description={t("general.hotkeyDesc")}
        aside={<StatusDot tone={hotkeyAdvice.tone}>{hotkeySummary}</StatusDot>}
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <p className={labelCls}>{t("general.currentHotkey")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {g.hotkey.hotkey_type === "combo" && g.hotkey.modifier ? (
                  <>
                    <kbd className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-sm font-semibold text-[var(--text)] shadow-sm">{formatHotkeyKey(g.hotkey.modifier)}</kbd>
                    <span className="text-xs text-[var(--text-muted)]">+</span>
                  </>
                ) : null}
                <kbd className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-sm font-semibold text-[var(--text)] shadow-sm">{formatHotkeyKey(g.hotkey.key)}</kbd>
                <span className="rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-xs text-[var(--text-secondary)]">
                  {t(`general.modeLabel_${g.hotkey.hotkey_type}`)}
                </span>
              </div>
            </div>

            <button
              type="button"
              className={`btn shrink-0 ${recording ? "btn-primary animate-pulse" : "btn-secondary"}`}
              onClick={recordHotkey}
              disabled={recording}
            >
              {recording ? t("general.recordingHotkey") : t("general.recordHotkey")}
            </button>
          </div>

          {recording ? (
            <Notice title={t("general.recordingHotkeyTitle")} tone="accent">
              <div className="space-y-2">
                <p>{t("general.recordingHotkeyBody")}</p>
                <p className={labelCls}>{t("general.recordingPressedKeys")}</p>
                <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
                  {pressedKeys.length > 0 ? (
                    pressedKeys.map((key, index) => (
                      <Fragment key={key}>
                        {index > 0 ? <span className="text-xs text-[var(--text-muted)]">+</span> : null}
                        <kbd className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-sm font-semibold text-[var(--text)] shadow-sm">
                          {formatHotkeyKey(key)}
                        </kbd>
                      </Fragment>
                    ))
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">{t("general.recordingWaitingKeys")}</span>
                  )}
                </div>
              </div>
            </Notice>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              { value: "single", title: t("general.single"), description: t("general.singleDesc") },
              { value: "double_tap", title: t("general.doubleTap"), description: t("general.doubleTapDesc") },
              { value: "combo", title: t("general.combo"), description: t("general.comboDesc") },
              { value: "hold", title: t("general.hold"), description: t("general.holdDesc") },
            ] as const).map((option) => (
              <OptionCard
                key={option.value}
                title={option.title}
                description={option.description}
                selected={g.hotkey.hotkey_type === option.value}
                onClick={() => update({ hotkey: { ...g.hotkey, hotkey_type: option.value } })}
              />
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="hotkey-key" className={labelCls}>{t("general.key")}</label>
              <input
                id="hotkey-key"
                name="hotkey-key"
                list="hotkey-key-options"
                value={g.hotkey.key}
                onChange={(e) => update({ hotkey: { ...g.hotkey, key: e.target.value } })}
                className="field-input"
                placeholder={platform === "macos" ? "RCmd" : "RCtrl"}
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id="hotkey-key-options">
                {hotkeyKeySuggestions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <p className={hintCls}>{t("general.keyHint")}</p>
            </div>

            {g.hotkey.hotkey_type === "combo" ? (
              <div className="space-y-1.5">
                <label htmlFor="hotkey-modifier" className={labelCls}>{t("general.modifier")}</label>
                <input
                  id="hotkey-modifier"
                  name="hotkey-modifier"
                  list="hotkey-modifier-options"
                  value={g.hotkey.modifier ?? ""}
                  onChange={(e) => update({ hotkey: { ...g.hotkey, modifier: e.target.value || null } })}
                  className="field-input"
                  placeholder="Ctrl"
                  autoComplete="off"
                  spellCheck={false}
                />
                <datalist id="hotkey-modifier-options">
                  {hotkeyModifierSuggestions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
                <p className={hintCls}>{t("general.modifierHint")}</p>
              </div>
            ) : g.hotkey.hotkey_type === "double_tap" ? (
              <div className="space-y-1.5">
                <label htmlFor="hotkey-double-tap" className={labelCls}>{t("general.doubleTapInterval")}</label>
                <div className="flex items-center gap-2">
                  <input
                    id="hotkey-double-tap"
                    name="hotkey-double-tap"
                    type="number"
                    value={g.hotkey.double_tap_interval_ms}
                    onChange={(e) => update({ hotkey: { ...g.hotkey, double_tap_interval_ms: Number(e.target.value) } })}
                    className="field-input max-w-28"
                    min={100}
                    max={1000}
                    step={50}
                    inputMode="numeric"
                  />
                  <span className="text-xs text-[var(--text-muted)]">{t("general.ms")}</span>
                </div>
                <p className={hintCls}>{t("general.doubleTapHint")}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className={labelCls}>{t("general.hotkeyPreviewTitle")}</p>
                <p className="text-[13px] font-medium">{t("general.hotkeyPreview", { hotkey: hotkeySummary })}</p>
                <p className={hintCls}>{t("general.hotkeyBehaviorHint")}</p>
              </div>
            )}
          </div>

          {hotkeyValidation ? (
            <Notice title={t("general.hotkeyValidationTitle")} tone="danger">
              {t(HOTKEY_VALIDATION_COPY[hotkeyValidation.code])}
            </Notice>
          ) : null}

          <Notice title={t(hotkeyAdvice.titleKey)} tone={hotkeyAdvice.tone}>
            <div className="space-y-2">
              <p>{t(hotkeyAdvice.bodyKey, { recommended: recommendedHoldKey })}</p>
              {!isRecommendedHotkey ? (
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() =>
                    update({
                      hotkey: { ...g.hotkey, hotkey_type: "hold", key: recommendedKeyToken, modifier: null },
                    })
                  }
                >
                  {t("general.useRecommendedHotkey", { recommended: recommendedHoldKey })}
                </button>
              ) : null}
            </div>
          </Notice>

          <Notice title={t("general.hotkeyWindowPauseTitle")} tone="default">
            {t("general.hotkeyWindowPauseBody")}
          </Notice>
        </div>
      </Section>

      {/* Recording */}
      <Section title={t("general.sectionRecording")} description={t("general.recordingDesc")}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="microphone-device" className={labelCls}>{t("general.microphoneDevice")}</label>
              <button type="button" onClick={refreshDevices} className="btn btn-ghost text-xs">
                {t("general.refreshDevices")}
              </button>
            </div>
            <select
              id="microphone-device"
              name="microphone-device"
              value={g.microphone_device ?? ""}
              onChange={(e) => update({ microphone_device: e.target.value || null })}
              className="field-select"
            >
              <option value="">{t("general.defaultDevice")}</option>
              {audioDevices.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <p className={hintCls}>{t("general.microphoneHint")}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="max-recording" className={labelCls}>{t("general.maxRecording")}</label>
            <div className="flex items-center gap-2">
              <input
                id="max-recording"
                name="max-recording"
                type="number"
                value={g.max_recording_seconds}
                onChange={(e) => update({ max_recording_seconds: Number(e.target.value) })}
                className="field-input max-w-28"
                min={10}
                max={600}
                step={10}
                inputMode="numeric"
              />
              <span className="text-xs text-[var(--text-muted)]">{t("general.seconds")}</span>
            </div>
            <p className={hintCls}>{t("general.maxRecordingHint")}</p>
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p id="sound-effects-label" className="text-[13px] font-medium">{t("general.soundEffects")}</p>
              <p className={hintCls}>{t("general.soundEffectsHint")}</p>
            </div>
            <Toggle checked={g.sound_effects} onChange={(v) => update({ sound_effects: v })} ariaLabelledBy="sound-effects-label" />
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p id="auto-mute-label" className="text-[13px] font-medium">{t("general.autoMute")}</p>
              <p className={hintCls}>{t("general.autoMuteHint")}</p>
            </div>
            <Toggle checked={g.auto_mute} onChange={(v) => update({ auto_mute: v })} ariaLabelledBy="auto-mute-label" />
          </div>

          {platform === "linux" ? (
            <Notice title={t("general.autoMuteLinuxTitle")} tone="warning">
              {t("general.autoMuteLinuxBody")}
            </Notice>
          ) : null}
        </div>
      </Section>

      {/* Output */}
      <Section
        title={t("general.sectionOutput")}
        description={t("general.outputDesc")}
        aside={
          <StatusDot tone={g.output_mode === "auto_paste" ? "accent" : "default"}>
            {g.output_mode === "auto_paste" ? t("general.autoPaste") : t("general.clipboardOnly")}
          </StatusDot>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="space-y-1.5">
              <label htmlFor="clipboard-behavior" className={labelCls}>{t("general.clipboardBehavior")}</label>
              <select
                id="clipboard-behavior"
                name="clipboard-behavior"
                value={g.clipboard_behavior}
                onChange={(e) => update({ clipboard_behavior: e.target.value as "always" | "only_on_paste_fail" })}
                className="field-select max-w-md"
              >
                <option value="always">{t("general.alwaysCopy")}</option>
                <option value="only_on_paste_fail">{t("general.onPasteFail")}</option>
              </select>
              <p className={hintCls}>{t("general.clipboardBehaviorHint")}</p>
            </div>
          ) : null}

          <Notice title={t("general.platformNoteTitle")} tone="warning">
            {platformNote}
          </Notice>
        </div>
      </Section>

      {/* Appearance */}
      <Section title={t("general.sectionAppearance")} description={t("general.appearanceDesc")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="theme-select" className={labelCls}>{t("general.theme")}</label>
            <select
              id="theme-select"
              name="theme-select"
              value={g.theme}
              onChange={(e) => update({ theme: e.target.value })}
              className="field-select"
            >
              <option value="system">{t("general.system")}</option>
              <option value="light">{t("general.light")}</option>
              <option value="dark">{t("general.dark")}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="language-select" className={labelCls}>{t("general.language")}</label>
            <select
              id="language-select"
              name="language-select"
              value={g.language}
              onChange={(e) => {
                update({ language: e.target.value });
                i18n.changeLanguage(e.target.value);
              }}
              className="field-select"
            >
              <option value="zh-TW">繁體中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </Section>

      {/* Advanced */}
      <Section title={t("general.sectionAdvanced")} description={t("general.advancedDesc")}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="timeout-ms" className={labelCls}>{t("general.timeout")}</label>
              <div className="flex items-center gap-2">
                <input
                  id="timeout-ms"
                  name="timeout-ms"
                  type="number"
                  value={g.timeout_ms}
                  onChange={(e) => update({ timeout_ms: Number(e.target.value) })}
                  className="field-input"
                  min={5000}
                  max={120000}
                  step={1000}
                  inputMode="numeric"
                />
                <span className="text-xs text-[var(--text-muted)]">{t("general.ms")}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="max-retries" className={labelCls}>{t("general.maxRetries")}</label>
              <input
                id="max-retries"
                name="max-retries"
                type="number"
                value={g.max_retries}
                onChange={(e) => update({ max_retries: Number(e.target.value) })}
                className="field-input"
                min={0}
                max={5}
                step={1}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p id="auto-start-label" className="text-[13px] font-medium">{t("general.autoStart")}</p>
              <p className={hintCls}>{t("general.autoStartHint")}</p>
            </div>
            <Toggle checked={g.auto_start} onChange={(v) => update({ auto_start: v })} ariaLabelledBy="auto-start-label" />
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p id="close-to-tray-label" className="text-[13px] font-medium">{t("general.closeToTray")}</p>
              <p className={hintCls}>{t("general.closeToTrayHint")}</p>
            </div>
            <Toggle checked={g.close_to_tray} onChange={(v) => update({ close_to_tray: v })} ariaLabelledBy="close-to-tray-label" />
          </div>

          <Notice title={t("general.advancedNoteTitle")} tone="default">
            {t("general.advancedNote")}
          </Notice>
        </div>
      </Section>
    </div>
  );
}
