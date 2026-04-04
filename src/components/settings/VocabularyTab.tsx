import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import type { VocabularyEntry } from "../../stores/settingsStore";
import { EmptyState, Notice, SectionCard, StatusPill } from "./SettingPrimitives";

export default function VocabularyTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [wrong, setWrong] = useState("");
  const [correct, setCorrect] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  if (!settings) return null;

  const vocab = settings.prompt.vocabulary;

  const addEntry = () => {
    if (!wrong.trim() || !correct.trim()) {
      setValidationMessage(t("vocabulary.validationRequired"));
      return;
    }

    if (
      vocab.some(
        (entry) => entry.wrong.trim().toLowerCase() === wrong.trim().toLowerCase()
      )
    ) {
      setValidationMessage(t("vocabulary.validationDuplicate"));
      return;
    }

    const entry: VocabularyEntry = { wrong: wrong.trim(), correct: correct.trim() };
    updateSettings({
      prompt: { ...settings.prompt, vocabulary: [...vocab, entry] },
    });
    setWrong("");
    setCorrect("");
    setValidationMessage(null);
  };

  const removeEntry = (idx: number) => {
    updateSettings({
      prompt: {
        ...settings.prompt,
        vocabulary: vocab.filter((_, i) => i !== idx),
      },
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addEntry();
    }
  };

  return (
    <div className="space-y-6">
      <Notice title={t("vocabulary.safeCustomizationTitle")} tone="accent">
        {t("vocabulary.safeCustomizationBody")}
      </Notice>

      <SectionCard title={t("vocabulary.addTitle")} description={t("vocabulary.addDesc")}>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <label htmlFor="wrong-form" className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {t("vocabulary.wrongForm")}
              </label>
              <input
                id="wrong-form"
                name="wrong-form"
                value={wrong}
                onChange={(e) => {
                  setWrong(e.target.value);
                  setValidationMessage(null);
                }}
                onKeyDown={handleKeyDown}
                className="app-input"
                placeholder="eg: 台風"
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="correct-form" className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {t("vocabulary.correctForm")}
              </label>
              <input
                id="correct-form"
                name="correct-form"
                value={correct}
                onChange={(e) => {
                  setCorrect(e.target.value);
                  setValidationMessage(null);
                }}
                onKeyDown={handleKeyDown}
                className="app-input"
                placeholder="eg: 颱風"
                autoComplete="off"
              />
            </div>

            <button onClick={addEntry} className="app-button-primary md:mb-0.5">
              {t("vocabulary.addEntry")}
            </button>
          </div>

          {validationMessage ? (
            <Notice title={t("vocabulary.validationTitle")} tone="warning">
              {validationMessage}
            </Notice>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        title={t("vocabulary.listTitle")}
        description={t("vocabulary.listDesc")}
        aside={<StatusPill tone={vocab.length > 0 ? "accent" : "default"}>{t("vocabulary.entryCount", { count: vocab.length })}</StatusPill>}
      >
        {vocab.length === 0 ? (
          <EmptyState
            icon="📖"
            title={t("vocabulary.noEntries")}
            description={t("vocabulary.emptyHint")}
          />
        ) : (
          <div className="space-y-3">
            {vocab.map((entry, idx) => (
              <div key={`${entry.wrong}-${entry.correct}-${idx}`} className="app-subtle-surface flex flex-col gap-3 rounded-2xl border border-black/5 p-4 dark:border-white/8 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                    {t("vocabulary.correctionRule")}
                  </p>
                  <p className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                    {entry.wrong} <span className="mx-2 text-gray-400">→</span> {entry.correct}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(t("vocabulary.confirmDelete"))) {
                      removeEntry(idx);
                    }
                  }}
                  className="app-button-danger shrink-0 px-3 py-1.5 text-xs"
                >
                  {t("actions.delete")}
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
