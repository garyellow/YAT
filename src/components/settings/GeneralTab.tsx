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
import { Notice, OptionCard, Section } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";
import { HintTip } from "../ui/Tooltip";

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
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);
  const platform = useAppStore((s) => s.platform);
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

  const modeLabel = (type: string) => {
    switch (type) {
      case "hold": return t("general.hold");
      case "combo": return t("general.combo");
      case "double_tap": return t("general.doubleTap");
      case "single": return t("general.single");
      default: return type;
    }
  };

  return (
    <div className="space-y-10">
      {/* ── Hotkey ── */}
      <Section title={t("general.hotkey")} description={t("general.hotkeyDesc")}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-4">
            <div className="space-y-1">
              <p className="text-[11px] text-[var(--text-muted)]">{t("general.currentHotkey")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {g.hotkey.hotkey_type === "combo" && g.hotkey.modifier ? (
                  <>
                    <kbd className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] shadow-sm">{formatHotkeyKey(g.hotkey.modifier)}</kbd>
                    <span className="text-xs text-[var(--text-muted)]">+</span>
                  </>
                ) : null}
                <kbd className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] shadow-sm">{formatHotkeyKey(g.hotkey.key)}</kbd>
                <span className="rounded-full bg-[var(--accent-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)]">
                  {modeLabel(g.hotkey.hotkey_type)}
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
            <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-subtle)] p-4">
              <p className="text-[13px] font-medium text-[var(--text)] mb-2">{t("general.recordingHotkeyTitle")}</p>
              <p className="text-xs text-[var(--text-secondary)] mb-3">{t("general.recordingHotkeyBody")}</p>
              <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                {pressedKeys.length > 0 ? (
                  pressedKeys.map((key, index) => (
                    <Fragment key={key}>
                      {index > 0 ? <span className="text-xs text-[var(--text-muted)]">+</span> : null}
                      <kbd className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-1.5 text-sm font-semibold text-[var(--text)] shadow-sm">
                        {formatHotkeyKey(key)}
                      </kbd>
                    </Fragment>
                  ))
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">{t("general.recordingWaitingKeys")}</span>
                )}
              </div>
            </div>
          ) : null}

          {hotkeyValidation ? (
            <Notice title={t("general.hotkeyValidationTitle")} tone="danger">
              {t(HOTKEY_VALIDATION_COPY[hotkeyValidation.code])}
            </Notice>
          ) : null}
        </div>
      </Section>

      {/* ── Recording ── */}
      <Section title={t("general.sectionRecording")} description={t("general.recordingDesc")}>
        <div className="space-y-5">
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
            <div className="flex items-center gap-3">
              <input
                id="max-recording"
                name="max-recording"
                type="range"
                value={g.max_recording_seconds}
                onChange={(e) => update({ max_recording_seconds: Number(e.target.value) })}
                className="flex-1 accent-[var(--accent)]"
                min={10}
                max={600}
                step={10}
              />
              <span className="w-14 text-right text-xs font-medium tabular-nums text-[var(--text-secondary)]">{g.max_recording_seconds}{t("general.seconds")}</span>
            </div>
            <p className={hintCls}>{t("general.maxRecordingHint")}</p>
          </div>

          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex items-center gap-1.5">
              <p id="sound-effects-label" className="text-[13px] font-medium">{t("general.soundEffects")}</p>
              <HintTip text={t("general.soundEffectsHint")} />
            </div>
            <Toggle checked={g.sound_effects} onChange={(v) => update({ sound_effects: v })} ariaLabelledBy="sound-effects-label" />
          </div>

          {platform !== "linux" ? (
            <div className="flex items-center justify-between gap-4 py-1">
              <div className="flex items-center gap-1.5">
                <p id="auto-mute-label" className="text-[13px] font-medium">{t("general.autoMute")}</p>
                <HintTip text={t("general.autoMuteHint")} />
              </div>
              <Toggle checked={g.auto_mute} onChange={(v) => update({ auto_mute: v })} ariaLabelledBy="auto-mute-label" />
            </div>
          ) : null}
        </div>
      </Section>

      {/* ── Output ── */}
      <Section title={t("general.sectionOutput")} description={t("general.outputDesc")}>
        <div className="space-y-5">
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
            <div className="flex items-center justify-between gap-4 py-1">
              <div className="flex items-center gap-1.5">
                <p id="clipboard-behavior-label" className="text-[13px] font-medium">{t("general.alwaysCopyToggle")}</p>
                <HintTip text={t("general.alwaysCopyToggleHint")} />
              </div>
              <Toggle
                checked={g.clipboard_behavior === "always"}
                onChange={(v) => update({ clipboard_behavior: v ? "always" : "only_on_paste_fail" })}
                ariaLabelledBy="clipboard-behavior-label"
              />
            </div>
          ) : null}
        </div>
      </Section>

      {/* ── Appearance ── */}
      <Section title={t("general.sectionAppearance")} description={t("general.appearanceDesc")}>
        <Notice title={t("general.appearanceQuickToggleTitle")} tone="default">
          {t("general.appearanceQuickToggleBody")}
        </Notice>
      </Section>

      {/* ── Window Behavior ── */}
      <Section title={t("general.sectionWindow")} description={t("general.windowBehaviorDesc")}>
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex items-center gap-1.5">
              <p id="close-to-tray-label" className="text-[13px] font-medium">{t("general.closeToTray")}</p>
              <HintTip text={t("general.closeToTrayHint")} />
            </div>
            <Toggle checked={g.close_to_tray} onChange={(v) => update({ close_to_tray: v })} ariaLabelledBy="close-to-tray-label" />
          </div>

          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex items-center gap-1.5">
              <p id="auto-start-label" className="text-[13px] font-medium">{t("general.autoStart")}</p>
              <HintTip text={t("general.autoStartHint")} />
            </div>
            <Toggle checked={g.auto_start} onChange={(v) => update({ auto_start: v })} ariaLabelledBy="auto-start-label" />
          </div>

          {g.auto_start ? (
            <div className="flex items-center justify-between gap-4 py-1 pl-4 border-l-2 border-[var(--border)]">
              <div className="flex items-center gap-1.5">
                <p id="start-minimized-label" className="text-[13px] font-medium">{t("general.startMinimized")}</p>
                <HintTip text={t("general.startMinimizedHint")} />
              </div>
              <Toggle checked={g.start_minimized} onChange={(v) => update({ start_minimized: v })} ariaLabelledBy="start-minimized-label" />
            </div>
          ) : null}
        </div>
      </Section>

      {/* ── Network ── */}
      <Section title={t("general.sectionNetwork")} description={t("general.networkDesc")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor="timeout-ms" className={labelCls}>{t("general.timeout")}</label>
              <HintTip text={t("general.timeoutHint")} />
            </div>
            <div className="flex items-center gap-3">
              <input
                id="timeout-ms"
                name="timeout-ms"
                type="range"
                value={g.timeout_ms}
                onChange={(e) => update({ timeout_ms: Number(e.target.value) })}
                className="flex-1 accent-[var(--accent)]"
                min={5000}
                max={120000}
                step={1000}
              />
              <span className="w-12 text-right text-xs font-medium tabular-nums text-[var(--text-secondary)]">{g.timeout_ms / 1000}s</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor="max-retries" className={labelCls}>{t("general.maxRetries")}</label>
              <HintTip text={t("general.maxRetriesHint")} />
            </div>
            <div className="flex items-center gap-3">
              <input
                id="max-retries"
                name="max-retries"
                type="range"
                value={g.max_retries}
                onChange={(e) => update({ max_retries: Number(e.target.value) })}
                className="flex-1 accent-[var(--accent)]"
                min={0}
                max={5}
                step={1}
              />
              <span className="w-8 text-right text-xs font-medium tabular-nums text-[var(--text-secondary)]">{g.max_retries}</span>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
