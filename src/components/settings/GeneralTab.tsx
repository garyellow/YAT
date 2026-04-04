import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/appStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { formatHotkeyCombo } from "../../lib/settingsFormatters";
import type { AppSettings } from "../../stores/settingsStore";
import { Notice, OptionCard, SectionCard, StatusPill } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";

const fieldLabelCls = "text-sm font-medium text-gray-700 dark:text-gray-200";
const fieldHintCls = "text-xs leading-5 text-gray-500 dark:text-gray-400";

export default function GeneralTab() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);
  const platform = useAppStore((s) => s.platform);

  useEffect(() => {
    invoke<string[]>("list_audio_devices").then(setAudioDevices).catch(() => {});
  }, []);

  if (!settings) return null;

  const g = settings.general;

  const update = (patch: Partial<AppSettings["general"]>) => {
    updateSettings({ general: { ...g, ...patch } });
  };

  const hotkeySummary = formatHotkeyCombo(g.hotkey);
  const refreshDevices = () => {
    invoke<string[]>("list_audio_devices").then(setAudioDevices).catch(() => {});
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
    <div className="space-y-6">
      <Notice title={t("general.quickStartTitle")} tone="accent">
        {t("general.quickStartDesc", { hotkey: hotkeySummary })}
      </Notice>

      <SectionCard
        title={t("general.hotkey")}
        description={t("general.hotkeyDesc")}
        aside={<StatusPill tone="accent">{hotkeySummary}</StatusPill>}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                onClick={() =>
                  update({
                    hotkey: {
                      ...g.hotkey,
                      hotkey_type: option.value,
                    },
                  })
                }
              />
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="hotkey-key" className={fieldLabelCls}>
                {t("general.key")}
              </label>
              <input
                id="hotkey-key"
                name="hotkey-key"
                value={g.hotkey.key}
                onChange={(e) => update({ hotkey: { ...g.hotkey, key: e.target.value } })}
                className="app-input"
                placeholder="Alt"
                autoComplete="off"
              />
              <p className={fieldHintCls}>{t("general.keyHint")}</p>
            </div>

            {g.hotkey.hotkey_type === "combo" ? (
              <div className="space-y-2">
                <label htmlFor="hotkey-modifier" className={fieldLabelCls}>
                  {t("general.modifier")}
                </label>
                <input
                  id="hotkey-modifier"
                  name="hotkey-modifier"
                  value={g.hotkey.modifier ?? ""}
                  onChange={(e) =>
                    update({
                      hotkey: { ...g.hotkey, modifier: e.target.value || null },
                    })
                  }
                  className="app-input"
                  placeholder="Ctrl"
                  autoComplete="off"
                />
                <p className={fieldHintCls}>{t("general.modifierHint")}</p>
              </div>
            ) : g.hotkey.hotkey_type === "double_tap" ? (
              <div className="space-y-2">
                <label htmlFor="hotkey-double-tap" className={fieldLabelCls}>
                  {t("general.doubleTapInterval")}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="hotkey-double-tap"
                    name="hotkey-double-tap"
                    type="number"
                    value={g.hotkey.double_tap_interval_ms}
                    onChange={(e) =>
                      update({
                        hotkey: {
                          ...g.hotkey,
                          double_tap_interval_ms: Number(e.target.value),
                        },
                      })
                    }
                    className="app-input max-w-32"
                    min={100}
                    max={1000}
                    step={50}
                    inputMode="numeric"
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">{t("general.ms")}</span>
                </div>
                <p className={fieldHintCls}>{t("general.doubleTapHint")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className={fieldLabelCls}>{t("general.hotkeyPreviewTitle")}</p>
                <div className="app-callout" data-tone="accent">
                  <p className="text-sm font-semibold tracking-tight">{t("general.hotkeyPreview", { hotkey: hotkeySummary })}</p>
                  <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    {t("general.hotkeyBehaviorHint")}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("general.sectionRecording")} description={t("general.recordingDesc")}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="microphone-device" className={fieldLabelCls}>
                  {t("general.microphoneDevice")}
                </label>
                <button
                  type="button"
                  onClick={refreshDevices}
                  className="app-button-ghost px-3 py-2 text-xs"
                  aria-label={t("general.refreshDevices")}
                >
                  {t("general.refreshDevices")}
                </button>
              </div>
              <select
                id="microphone-device"
                name="microphone-device"
                value={g.microphone_device ?? ""}
                onChange={(e) => update({ microphone_device: e.target.value || null })}
                className="app-select"
              >
                <option value="">{t("general.defaultDevice")}</option>
                {audioDevices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <p className={fieldHintCls}>{t("general.microphoneHint")}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="max-recording" className={fieldLabelCls}>
                {t("general.maxRecording")}
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="max-recording"
                  name="max-recording"
                  type="number"
                  value={g.max_recording_seconds}
                  onChange={(e) => update({ max_recording_seconds: Number(e.target.value) })}
                  className="app-input max-w-32"
                  min={10}
                  max={600}
                  step={10}
                  inputMode="numeric"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">{t("general.seconds")}</span>
              </div>
              <p className={fieldHintCls}>{t("general.maxRecordingHint")}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="app-subtle-surface flex items-center justify-between rounded-2xl border border-black/5 px-4 py-4 dark:border-white/8">
              <div className="space-y-1">
                <p id="sound-effects-label" className="text-sm font-semibold tracking-tight">{t("general.soundEffects")}</p>
                <p className={fieldHintCls}>{t("general.soundEffectsHint")}</p>
              </div>
              <Toggle
                checked={g.sound_effects}
                onChange={(v) => update({ sound_effects: v })}
                ariaLabelledBy="sound-effects-label"
              />
            </div>

            <div className="app-subtle-surface flex items-center justify-between rounded-2xl border border-black/5 px-4 py-4 dark:border-white/8">
              <div className="space-y-1">
                <p id="auto-mute-label" className="text-sm font-semibold tracking-tight">{t("general.autoMute")}</p>
                <p className={fieldHintCls}>{t("general.autoMuteHint")}</p>
              </div>
              <Toggle
                checked={g.auto_mute}
                onChange={(v) => update({ auto_mute: v })}
                ariaLabelledBy="auto-mute-label"
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("general.sectionOutput")}
        description={t("general.outputDesc")}
        aside={<StatusPill tone={g.output_mode === "auto_paste" ? "accent" : "default"}>{g.output_mode === "auto_paste" ? t("general.autoPaste") : t("general.clipboardOnly")}</StatusPill>}
      >
        <div className="space-y-4">
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
            <div className="space-y-2">
              <label htmlFor="clipboard-behavior" className={fieldLabelCls}>
                {t("general.clipboardBehavior")}
              </label>
              <select
                id="clipboard-behavior"
                name="clipboard-behavior"
                value={g.clipboard_behavior}
                onChange={(e) =>
                  update({
                    clipboard_behavior: e.target.value as "always" | "only_on_paste_fail",
                  })
                }
                className="app-select max-w-xl"
              >
                <option value="always">{t("general.alwaysCopy")}</option>
                <option value="only_on_paste_fail">{t("general.onPasteFail")}</option>
              </select>
              <p className={fieldHintCls}>{t("general.clipboardBehaviorHint")}</p>
            </div>
          ) : null}

          <Notice title={t("general.platformNoteTitle")} tone="warning">
            {platformNote}
          </Notice>
        </div>
      </SectionCard>

      <SectionCard title={t("general.sectionAppearance")} description={t("general.appearanceDesc")}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="theme-select" className={fieldLabelCls}>
              {t("general.theme")}
            </label>
            <select
              id="theme-select"
              name="theme-select"
              value={g.theme}
              onChange={(e) => update({ theme: e.target.value })}
              className="app-select"
            >
              <option value="system">{t("general.system")}</option>
              <option value="light">{t("general.light")}</option>
              <option value="dark">{t("general.dark")}</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="language-select" className={fieldLabelCls}>
              {t("general.language")}
            </label>
            <select
              id="language-select"
              name="language-select"
              value={g.language}
              onChange={(e) => {
                update({ language: e.target.value });
                i18n.changeLanguage(e.target.value);
              }}
              className="app-select"
            >
              <option value="zh-TW">繁體中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("general.sectionAdvanced")} description={t("general.advancedDesc")}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="timeout-ms" className={fieldLabelCls}>
                {t("general.timeout")}
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="timeout-ms"
                  name="timeout-ms"
                  type="number"
                  value={g.timeout_ms}
                  onChange={(e) => update({ timeout_ms: Number(e.target.value) })}
                  className="app-input"
                  min={5000}
                  max={120000}
                  step={1000}
                  inputMode="numeric"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">{t("general.ms")}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="max-retries" className={fieldLabelCls}>
                {t("general.maxRetries")}
              </label>
              <input
                id="max-retries"
                name="max-retries"
                type="number"
                value={g.max_retries}
                onChange={(e) => update({ max_retries: Number(e.target.value) })}
                className="app-input"
                min={0}
                max={5}
                step={1}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="app-subtle-surface flex items-center justify-between rounded-2xl border border-black/5 px-4 py-4 dark:border-white/8">
              <div className="space-y-1">
                <p id="auto-start-label" className="text-sm font-semibold tracking-tight">{t("general.autoStart")}</p>
                <p className={fieldHintCls}>{t("general.autoStartHint")}</p>
              </div>
              <Toggle
                checked={g.auto_start}
                onChange={(v) => update({ auto_start: v })}
                ariaLabelledBy="auto-start-label"
              />
            </div>

            <Notice title={t("general.advancedNoteTitle")} tone="default">
              {t("general.advancedNote")}
            </Notice>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
