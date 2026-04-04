import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import type { VocabularyEntry } from "../../stores/settingsStore";

export default function VocabularyTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const saved = useSettingsStore((s) => s.saved);

  const [wrong, setWrong] = useState("");
  const [correct, setCorrect] = useState("");

  if (!settings) return null;

  const vocab = settings.prompt.vocabulary;

  const addEntry = () => {
    if (!wrong.trim() || !correct.trim()) return;
    const entry: VocabularyEntry = { wrong: wrong.trim(), correct: correct.trim() };
    updateSettings({
      prompt: { ...settings.prompt, vocabulary: [...vocab, entry] },
    });
    setWrong("");
    setCorrect("");
  };

  const removeEntry = (idx: number) => {
    updateSettings({
      prompt: {
        ...settings.prompt,
        vocabulary: vocab.filter((_, i) => i !== idx),
      },
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-xl font-semibold">{t("tabs.vocabulary")}</h2>

      {/* Add new entry */}
      <div className="flex items-end gap-2">
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-sm">{t("vocabulary.wrongForm")}</span>
          <input
            value={wrong}
            onChange={(e) => setWrong(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            placeholder="eg: 台風"
          />
        </label>
        <label className="flex-1 flex flex-col gap-1">
          <span className="text-sm">{t("vocabulary.correctForm")}</span>
          <input
            value={correct}
            onChange={(e) => setCorrect(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            placeholder="eg: 颱風"
          />
        </label>
        <button
          onClick={addEntry}
          className="px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("vocabulary.addEntry")}
        </button>
      </div>

      {/* Vocabulary list */}
      {vocab.length === 0 ? (
        <p className="text-sm text-gray-500">{t("vocabulary.noEntries")}</p>
      ) : (
        <table className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="text-left px-4 py-2 font-medium">
                {t("vocabulary.wrongForm")}
              </th>
              <th className="text-left px-4 py-2 font-medium">
                {t("vocabulary.correctForm")}
              </th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {vocab.map((entry, idx) => (
              <tr
                key={idx}
                className="border-t border-gray-200 dark:border-gray-700"
              >
                <td className="px-4 py-2">{entry.wrong}</td>
                <td className="px-4 py-2">{entry.correct}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => removeEntry(idx)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    {t("actions.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
