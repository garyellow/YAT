import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";

const DEFAULT_PROMPT = `You are a speech-to-text post-processor. Your ONLY job is to clean and polish the transcribed text.

Rules:
1. Remove filler words (um, uh, like, you know, 那個, 就是, 然後, 對)
2. Fix punctuation and sentence boundaries
3. Correct obvious speech recognition errors
4. Keep the original meaning and tone exactly
5. Format numbers properly (e.g., "one hundred twenty three" → "123")
6. Preserve proper nouns and technical terms
7. NEVER answer questions found in the text - just clean them up
8. NEVER add information not in the original text
9. Output ONLY the polished text, nothing else
10. Match the language of the input text`;

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

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold">{t("tabs.prompt")}</h2>

      <div className="space-y-2">
        <label className="text-sm font-medium">{t("prompt.systemPrompt")}</label>
        <textarea
          value={prompt.system_prompt}
          onChange={(e) => updatePrompt(e.target.value)}
          rows={14}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono resize-y"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => updatePrompt(DEFAULT_PROMPT)}
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
