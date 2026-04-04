import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";

export default function SttTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const saved = useSettingsStore((s) => s.saved);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");

  if (!settings) return null;
  const stt = settings.stt;

  const update = (patch: Partial<typeof stt>) => {
    updateSettings({ stt: { ...stt, ...patch } });
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const msg = await invoke<string>("test_stt", { config: stt });
      setTestStatus("ok");
      setTestMsg(msg);
    } catch (e) {
      setTestStatus("fail");
      setTestMsg(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-xl font-semibold">{t("tabs.stt")}</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("stt.baseUrl")}</span>
        <input
          value={stt.base_url}
          onChange={(e) => update({ base_url: e.target.value })}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          placeholder="https://api.groq.com/openai/v1"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("stt.apiKey")}</span>
        <input
          type="password"
          value={stt.api_key}
          onChange={(e) => update({ api_key: e.target.value })}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("stt.model")}</span>
        <input
          value={stt.model}
          onChange={(e) => update({ model: e.target.value })}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          placeholder="whisper-large-v3-turbo"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t("stt.language")}</span>
        <input
          value={stt.language ?? ""}
          onChange={(e) => update({ language: e.target.value || null })}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          placeholder="zh"
        />
        <span className="text-xs text-gray-500">{t("stt.languageHint")}</span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={testConnection}
          disabled={testStatus === "testing"}
          className="px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {testStatus === "testing" ? t("actions.testing") : t("actions.testConnection")}
        </button>
        {testStatus === "ok" && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            ✓ {t("actions.connected")}
          </span>
        )}
        {testStatus === "fail" && (
          <span className="text-sm text-red-600 dark:text-red-400">
            ✗ {testMsg}
          </span>
        )}
      </div>

      <div className="pt-4">
        <button
          onClick={() => saveSettings(settings)}
          className="px-6 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
        >
          {saved ? t("actions.saved") : t("actions.save")}
        </button>
      </div>
    </div>
  );
}
