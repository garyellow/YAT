import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";

export default function LlmTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const saved = useSettingsStore((s) => s.saved);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");

  if (!settings) return null;
  const llm = settings.llm;

  const update = (patch: Partial<typeof llm>) => {
    updateSettings({ llm: { ...llm, ...patch } });
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const msg = await invoke<string>("test_llm", { config: llm });
      setTestStatus("ok");
      setTestMsg(msg);
    } catch (e) {
      setTestStatus("fail");
      setTestMsg(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-xl font-semibold">{t("tabs.llm")}</h2>

      <label className="flex items-center gap-3">
        <span className="text-sm font-medium">{t("llm.enabled")}</span>
        <input
          type="checkbox"
          checked={llm.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
      </label>

      {llm.enabled && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("llm.baseUrl")}</span>
            <input
              value={llm.base_url}
              onChange={(e) => update({ base_url: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              placeholder="https://api.groq.com/openai/v1"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("llm.apiKey")}</span>
            <input
              type="password"
              value={llm.api_key}
              onChange={(e) => update({ api_key: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("llm.model")}</span>
            <input
              value={llm.model}
              onChange={(e) => update({ model: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              placeholder="llama-3.3-70b-versatile"
            />
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={testConnection}
              disabled={testStatus === "testing"}
              className="px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {testStatus === "testing" ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t("actions.testing")}
                </span>
              ) : t("actions.testConnection")}
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
        </>
      )}

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
