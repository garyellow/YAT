import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/appStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  formatHotkeyCombo,
  formatHotkeyKey,
  getHotkeyAdvice,
  getRecommendedHotkeyLabel,
} from "../../lib/settingsFormatters";
import type { AppSettings, HotkeyConfig } from "../../stores/settingsStore";
import { Notice, OptionCard, Section, StatusDot } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";
import { HintTip } from "../ui/Tooltip";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";

export default function GeneralTab() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const platform = useAppStore((s) => s.platform);

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
  const recommendedHoldKey = getRecommendedHotkeyLabel(platform);
  const isRecommendedHotkey =
    g.hotkey.hotkey_type === "hold" &&
    g.hotkey.key.trim().toLowerCase() === recommendedKeyToken.toLowerCase();

  const refreshDevices = () => {
    invoke<string[]>("list_audio_devices")
      .then(setAudioDevices)
      .catch((e) => console.error("Failed to list audio devices:", e));
  };

  const recordHotkey = async () => {
    setRecording(true);
    try {
      const result = await invoke<HotkeyConfig>("record_hotkey");
      update({ hotkey: result });
    } catch {
      // timeout or cancel — do nothing
    } finally {
      setRecording(false);
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
          {/* Current hotkey display + record button */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1.5">
              <p className={labelCls}>{t("general.currentHotkey")}</p>
              <div className="flex flex-wrap items-center gap-2">
                {g.hotkey.hotkey_type === "combo" && g.hotkey.modifier ? (
                  <>
                    <kbd className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-sm font-semibold text-[var(--text-primary)] shadow-sm">{formatHotkeyKey(g.hotkey.modifier)}</kbd>
                    <span className="text-xs text-[var(--text-muted)]">+</span>
                  </>
                ) : null}
                <kbd className="inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-sm font-semibold text-[var(--text-primary)] shadow-sm">{formatHotkeyKey(g.hotkey.key)}</kbd>
                <span className="rounded-full bg-[var(--surface-raised)] px-2.5 py-0.5 text-xs text-[var(--text-secondary)]">
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
              {t("general.recordingHotkeyBody")}
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
              <label htmlFor="microphone-device" className={labelCls}>{t("general.microphoneDevice")} <HintTip text={t("general.microphoneHint")} /></label>
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
          </div>

          <div className="space-y-1.5">
            <label htmlFor="max-recording" className={labelCls}>{t("general.maxRecording")} <HintTip text={t("general.maxRecordingHint")} /></label>
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
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p id="sound-effects-label" className="text-[13px] font-medium">{t("general.soundEffects")} <HintTip text={t("general.soundEffectsHint")} /></p>
            </div>
            <Toggle checked={g.sound_effects} onChange={(v) => update({ sound_effects: v })} ariaLabelledBy="sound-effects-label" />
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p id="auto-mute-label" className="text-[13px] font-medium">{t("general.autoMute")} <HintTip text={t("general.autoMuteHint")} /></p>
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
              <label htmlFor="clipboard-behavior" className={labelCls}>{t("general.clipboardBehavior")} <HintTip text={t("general.clipboardBehaviorHint")} /></label>
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
                  value={Math.round(g.timeout_ms / 1000)}
                  onChange={(e) => update({ timeout_ms: Number(e.target.value) * 1000 })}
                  className="field-input"
                  min={5}
                  max={120}
                  step={1}
                  inputMode="numeric"
                />
                <span className="text-xs text-[var(--text-muted)]">{t("general.seconds")}</span>
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
              <p id="auto-start-label" className="text-[13px] font-medium">{t("general.autoStart")} <HintTip text={t("general.autoStartHint")} /></p>
            </div>
            <Toggle checked={g.auto_start} onChange={(v) => update({ auto_start: v })} ariaLabelledBy="auto-start-label" />
          </div>

          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <p id="close-to-tray-label" className="text-[13px] font-medium">{t("general.closeToTray")} <HintTip text={t("general.closeToTrayHint")} /></p>
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
