import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import type { AppSettings } from "../../stores/settingsStore";

export default function GeneralTab() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const saved = useSettingsStore((s) => s.saved);
  const [audioDevices, setAudioDevices] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("list_audio_devices").then(setAudioDevices).catch(() => {});
  }, []);

  if (!settings) return null;

  const g = settings.general;

  const update = (patch: Partial<AppSettings["general"]>) => {
    updateSettings({ general: { ...g, ...patch } });
  };

  const save = () => saveSettings(settings);

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-xl font-semibold">{t("tabs.general")}</h2>

      {/* Hotkey */}
      <fieldset className="space-y-3">
        <legend className="font-medium">{t("general.hotkey")}</legend>

        <label className="flex items-center gap-3">
          <span className="w-28 text-sm">{t("general.hotkeyType")}</span>
          <select
            value={g.hotkey.hotkey_type}
            onChange={(e) =>
              update({
                hotkey: {
                  ...g.hotkey,
                  hotkey_type: e.target.value as "single" | "double_tap" | "combo" | "hold",
                },
              })
            }
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          >
            <option value="single">{t("general.single")}</option>
            <option value="double_tap">{t("general.doubleTap")}</option>
            <option value="combo">{t("general.combo")}</option>
            <option value="hold">{t("general.hold")}</option>
          </select>
        </label>

        <label className="flex items-center gap-3">
          <span className="w-28 text-sm">{t("general.key")}</span>
          <input
            value={g.hotkey.key}
            onChange={(e) =>
              update({ hotkey: { ...g.hotkey, key: e.target.value } })
            }
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            placeholder="Alt"
          />
        </label>

        {g.hotkey.hotkey_type === "combo" && (
          <div className="ml-28 rounded-lg bg-gray-100 dark:bg-gray-800 p-3">
            <label className="flex items-center gap-3">
              <span className="w-28 text-sm">{t("general.modifier")}</span>
              <input
                value={g.hotkey.modifier ?? ""}
                onChange={(e) =>
                  update({
                    hotkey: { ...g.hotkey, modifier: e.target.value || null },
                  })
                }
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                placeholder="Ctrl"
              />
            </label>
          </div>
        )}

        {g.hotkey.hotkey_type === "double_tap" && (
          <div className="ml-28 rounded-lg bg-gray-100 dark:bg-gray-800 p-3">
            <label className="flex items-center gap-3">
              <span className="w-28 text-sm">{t("general.doubleTapInterval")}</span>
              <input
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
                className="w-24 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                min={100}
                max={1000}
              />
              <span className="text-sm text-gray-500">{t("general.ms")}</span>
            </label>
          </div>
        )}
      </fieldset>

      {/* Theme */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.theme")}</span>
        <select
          value={g.theme}
          onChange={(e) => update({ theme: e.target.value })}
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        >
          <option value="system">{t("general.system")}</option>
          <option value="light">{t("general.light")}</option>
          <option value="dark">{t("general.dark")}</option>
        </select>
      </label>

      {/* Language */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.language")}</span>
        <select
          value={g.language}
          onChange={(e) => {
            update({ language: e.target.value });
            i18n.changeLanguage(e.target.value);
          }}
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        >
          <option value="zh-TW">繁體中文</option>
          <option value="en">English</option>
        </select>
      </label>

      {/* Auto Start */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.autoStart")}</span>
        <input
          type="checkbox"
          checked={g.auto_start}
          onChange={(e) => update({ auto_start: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
      </label>

      {/* Max Recording */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.maxRecording")}</span>
        <input
          type="number"
          value={g.max_recording_seconds}
          onChange={(e) =>
            update({ max_recording_seconds: Number(e.target.value) })
          }
          className="w-24 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          min={10}
          max={600}
        />
        <span className="text-sm text-gray-500">{t("general.seconds")}</span>
      </label>

      {/* Output Mode */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.outputMode")}</span>
        <select
          value={g.output_mode}
          onChange={(e) =>
            update({
              output_mode: e.target.value as "auto_paste" | "clipboard_only",
            })
          }
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        >
          <option value="auto_paste">{t("general.autoPaste")}</option>
          <option value="clipboard_only">{t("general.clipboardOnly")}</option>
        </select>
      </label>

      {/* Clipboard Behavior */}
      {g.output_mode === "auto_paste" && (
        <label className="flex items-center gap-3">
          <span className="w-28 text-sm">{t("general.clipboardBehavior")}</span>
          <select
            value={g.clipboard_behavior}
            onChange={(e) =>
              update({
                clipboard_behavior: e.target.value as
                  | "always"
                  | "only_on_paste_fail",
              })
            }
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          >
            <option value="always">{t("general.alwaysCopy")}</option>
            <option value="only_on_paste_fail">{t("general.onPasteFail")}</option>
          </select>
        </label>
      )}

      {/* Timeout */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.timeout")}</span>
        <input
          type="number"
          value={g.timeout_ms}
          onChange={(e) => update({ timeout_ms: Number(e.target.value) })}
          className="w-28 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          min={5000}
          max={120000}
          step={1000}
        />
        <span className="text-sm text-gray-500">{t("general.ms")}</span>
      </label>

      {/* Max Retries */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.maxRetries")}</span>
        <input
          type="number"
          value={g.max_retries}
          onChange={(e) => update({ max_retries: Number(e.target.value) })}
          className="w-20 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          min={0}
          max={5}
        />
      </label>

      {/* Microphone Device */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.microphoneDevice")}</span>
        <select
          value={g.microphone_device ?? ""}
          onChange={(e) =>
            update({ microphone_device: e.target.value || null })
          }
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        >
          <option value="">{t("general.defaultDevice")}</option>
          {audioDevices.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            invoke<string[]>("list_audio_devices")
              .then(setAudioDevices)
              .catch(() => {})
          }
          className="px-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title={t("general.refreshDevices")}
        >
          ↻
        </button>
      </label>

      {/* Sound Effects */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.soundEffects")}</span>
        <input
          type="checkbox"
          checked={g.sound_effects}
          onChange={(e) => update({ sound_effects: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
      </label>

      {/* Auto Mute */}
      <label className="flex items-center gap-3">
        <span className="w-28 text-sm">{t("general.autoMute")}</span>
        <input
          type="checkbox"
          checked={g.auto_mute}
          onChange={(e) => update({ auto_mute: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
      </label>

      {/* Save Button */}
      <div className="pt-4">
        <button
          onClick={save}
          className="px-6 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
        >
          {saved ? t("actions.saved") : t("actions.save")}
        </button>
      </div>
    </div>
  );
}
