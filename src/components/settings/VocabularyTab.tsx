import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { EmptyState, Notice, Section, StatusDot } from "./SettingPrimitives";
import ConfirmDialog from "../ui/ConfirmDialog";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

export default function VocabularyTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [wrong, setWrong] = useState("");
  const [correct, setCorrect] = useState("");
  const [validationMsg, setValidationMsg] = useState("");
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);

  if (!settings) return null;
  const vocab = settings.prompt.vocabulary;

  const addEntry = () => {
    const w = wrong.trim();
    const c = correct.trim();
    if (!w || !c) {
      setValidationMsg(t("vocabulary.validationRequired"));
      return;
    }
    if (vocab.some((e) => e.wrong.trim().toLowerCase() === w.toLowerCase())) {
      setValidationMsg(t("vocabulary.validationDuplicate"));
      return;
    }
    setValidationMsg("");
    updateSettings({
      prompt: {
        ...settings.prompt,
        vocabulary: [...vocab, { wrong: w, correct: c }],
      },
    });
    setWrong("");
    setCorrect("");
  };

  const removeEntry = (index: number) => {
    updateSettings({
      prompt: {
        ...settings.prompt,
        vocabulary: vocab.filter((_, i) => i !== index),
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addEntry();
    }
  };

  const handleConfirmDelete = useCallback(() => {
    if (confirmIndex !== null) {
      removeEntry(confirmIndex);
      setConfirmIndex(null);
    }
  }, [confirmIndex]);

  return (
    <div className="space-y-10">
      <Notice title={t("vocabulary.safeCustomizationTitle")} tone="accent">
        {t("vocabulary.safeCustomizationBody")}
      </Notice>

      {/* Add entry */}
      <Section
        title={t("vocabulary.addTitle")}
        description={t("vocabulary.addDesc")}
        aside={
          <StatusDot tone="default">
            {t("vocabulary.entryCount", { count: vocab.length })}
          </StatusDot>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div className="space-y-1.5">
              <label htmlFor="vocab-wrong" className={labelCls}>{t("vocabulary.wrongForm")}</label>
              <input
                id="vocab-wrong"
                name="vocab-wrong"
                value={wrong}
                onChange={(e) => setWrong(e.target.value)}
                onKeyDown={handleKeyDown}
                className="field-input"
                placeholder={t("vocabulary.wrongPlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="vocab-correct" className={labelCls}>{t("vocabulary.correctForm")}</label>
              <input
                id="vocab-correct"
                name="vocab-correct"
                value={correct}
                onChange={(e) => setCorrect(e.target.value)}
                onKeyDown={handleKeyDown}
                className="field-input"
                placeholder={t("vocabulary.correctPlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button type="button" onClick={addEntry} className="btn btn-primary">
              {t("vocabulary.addEntry")}
            </button>
          </div>

          {validationMsg ? (
            <p role="alert" aria-live="assertive" className="text-xs text-[var(--red)]">{validationMsg}</p>
          ) : (
            <p className={hintCls}>{t("vocabulary.emptyHint")}</p>
          )}
        </div>
      </Section>

      {/* Vocabulary list */}
      <Section title={t("vocabulary.listTitle")} description={t("vocabulary.listDesc")}>
        {vocab.length === 0 ? (
          <EmptyState
            title={t("vocabulary.noEntries")}
            description={t("vocabulary.emptyHint")}
          />
        ) : (
          <div className="space-y-0">
            {vocab.map((entry, index) => (
              <div
                key={`${entry.wrong}-${index}`}
                className="group flex items-center justify-between gap-4 py-3 border-b border-[var(--border)] last:border-b-0 transition-colors duration-100 hover:bg-[var(--bg-subtle)] -mx-2 px-2 rounded"
              >
                <div className="min-w-0 flex items-center gap-2 text-[13px]">
                  <span className="text-[var(--text-muted)] line-through">{entry.wrong}</span>
                  <span className="text-[var(--text-muted)]">→</span>
                  <span className="font-medium">{entry.correct}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-danger text-xs shrink-0"
                  onClick={() => setConfirmIndex(index)}
                >
                  {t("actions.delete")}
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={confirmIndex !== null}
        title={t("actions.delete")}
        message={t("vocabulary.confirmDelete")}
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmIndex(null)}
      />
    </div>
  );
}
