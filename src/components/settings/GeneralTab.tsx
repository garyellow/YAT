import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/appStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  formatHotkeyCombo,
  getHotkeyAdvice,
  getRecommendedHotkeyLabel,
} from "../../lib/settingsFormatters";
import type { AppSettings } from "../../stores/settingsStore";
import { Notice, OptionCard, Section, StatusDot } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

export default function GeneralTab() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
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
                value={g.hotkey.key}
                onChange={(e) => update({ hotkey: { ...g.hotkey, key: e.target.value } })}
                className="field-input"
                placeholder={platform === "macos" ? "RCmd" : "RCtrl"}
                autoComplete="off"
                spellCheck={false}
              />
              <p className={hintCls}>{t("general.keyHint")}</p>
            </div>

            {g.hotkey.hotkey_type === "combo" ? (
              <div className="space-y-1.5">
                <label htmlFor="hotkey-modifier" className={labelCls}>{t("general.modifier")}</label>
                <input
                  id="hotkey-modifier"
                  name="hotkey-modifier"
                  value={g.hotkey.modifier ?? ""}
                  onChange={(e) => update({ hotkey: { ...g.hotkey, modifier: e.target.value || null } })}
                  className="field-input"
                  placeholder="Ctrl"
                  autoComplete="off"
                  spellCheck={false}
                />
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
