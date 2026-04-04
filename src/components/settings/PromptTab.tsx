import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";

export default function PromptTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const saved = useSettingsStore((s) => s.saved);

  if (!settings) return null;

  const prompt = settings.prompt;

  const updatePrompt = (system_prompt: string) => {
    updateSettings({ prompt: { ...prompt, system_prompt } });
  };

  const resetToDefault = async () => {
    const defaultPrompt = await invoke<string>("get_default_prompt");
    updatePrompt(defaultPrompt);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold">{t("tabs.prompt")}</h2>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">{t("prompt.systemPrompt")}</label>
          <span className="text-xs text-gray-400">{prompt.system_prompt.length} chars</span>
        </div>
        <textarea
          value={prompt.system_prompt}
          onChange={(e) => updatePrompt(e.target.value)}
          rows={14}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono resize-y"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={resetToDefault}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          {t("prompt.resetToDefault")}
        </button>
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
