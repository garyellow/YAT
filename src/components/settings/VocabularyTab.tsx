import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { EmptyState, Notice, PageIntro, Section, StatusDot } from "./SettingPrimitives";
import ConfirmDialog from "../ui/ConfirmDialog";
import type { SettingsTab } from "./tabs";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

function normalizeEntryKey(value: string): string {
  return value.trim().toLowerCase();
}

function parseVocabularyDraft(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

interface VocabularyTabProps {
  onNavigate?: (tab: SettingsTab) => void;
}

export default function VocabularyTab({ onNavigate }: VocabularyTabProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [draft, setDraft] = useState("");
  const [validationMsg, setValidationMsg] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editValidationMsg, setEditValidationMsg] = useState("");
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);

  if (!settings) return null;
  const vocab = settings.prompt.vocabulary;

  const addEntry = () => {
    const parsedEntries = parseVocabularyDraft(draft);

    if (parsedEntries.length === 0) {
      setValidationMsg(t("vocabulary.validationRequired"));
      return;
    }

    const existing = new Set(vocab.map((entry) => normalizeEntryKey(entry.text)));
    const seen = new Set<string>();
    const newEntries = parsedEntries
      .filter((entry) => {
        const key = normalizeEntryKey(entry);
        if (existing.has(key) || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((text) => ({ text }));

    if (newEntries.length === 0) {
      setValidationMsg(t("vocabulary.validationDuplicate"));
      return;
    }

    setValidationMsg("");
    updateSettings({
      prompt: {
        ...settings.prompt,
        vocabulary: [...vocab, ...newEntries],
      },
    });
    setDraft("");
  };

  const removeEntry = (index: number) => {
    setEditingIndex((current) => {
      if (current === null) return current;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
    setEditDraft("");
    setEditValidationMsg("");

    updateSettings({
      prompt: {
        ...settings.prompt,
        vocabulary: vocab.filter((_, i) => i !== index),
      },
    });
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditDraft(vocab[index]?.text ?? "");
    setEditValidationMsg("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditDraft("");
    setEditValidationMsg("");
  };

  const saveEdit = () => {
    if (editingIndex === null) {
      return;
    }

    const nextText = editDraft.trim();
    if (!nextText) {
      setEditValidationMsg(t("vocabulary.validationEditRequired"));
      return;
    }

    const duplicate = vocab.some(
      (entry, index) => index !== editingIndex && normalizeEntryKey(entry.text) === normalizeEntryKey(nextText),
    );

    if (duplicate) {
      setEditValidationMsg(t("vocabulary.validationEditDuplicate"));
      return;
    }

    updateSettings({
      prompt: {
        ...settings.prompt,
        vocabulary: vocab.map((entry, index) => (index === editingIndex ? { text: nextText } : entry)),
      },
    });

    cancelEdit();
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) {
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      addEntry();
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleConfirmDelete = () => {
    if (confirmIndex !== null) {
      removeEntry(confirmIndex);
      setConfirmIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow={t("settings.groups.customize")}
        title={t("tabs.vocabulary")}
        description={t("vocabulary.pageDesc")}
      />

      {!settings.llm.enabled ? (
        <Notice title={t("prompt.llmDisabledTitle")} tone="warning">
          <div className="space-y-3">
            <p>{t("prompt.llmDisabledBody")}</p>
            {onNavigate ? (
              <div>
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  onClick={() => onNavigate("llm")}
                >
                  {t("prompt.goEnableLlm")}
                </button>
              </div>
            ) : null}
          </div>
        </Notice>
      ) : null}

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
          <div className="space-y-1.5">
            <label htmlFor="vocab-entry" className={labelCls}>{t("vocabulary.termInput")}</label>
            <p className={hintCls}>{t("vocabulary.inputHint")}</p>
            <textarea
              id="vocab-entry"
              name="vocab-entry"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleAddKeyDown}
              className="field-textarea"
              placeholder={t("vocabulary.termPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              rows={6}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {validationMsg ? (
              <p role="alert" aria-live="assertive" className="text-xs text-[var(--red)]">{validationMsg}</p>
            ) : (
              <p className={hintCls}>{t("vocabulary.multilineHint")}</p>
            )}

            <button type="button" onClick={addEntry} className="btn btn-primary shrink-0">
              {t("vocabulary.addEntry")}
            </button>
          </div>
        </div>
      </Section>

      <Section title={t("vocabulary.listTitle")} description={t("vocabulary.listDesc")}>
        {vocab.length === 0 ? (
          <EmptyState
            title={t("vocabulary.noEntries")}
            description={t("vocabulary.emptyHint")}
          />
        ) : (
          <div className="space-y-3">
            {vocab.map((entry, index) => (
              <div
                key={`${entry.text}-${index}`}
                className="group rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 transition-colors duration-100 hover:bg-[var(--bg-muted)]"
              >
                {editingIndex === index ? (
                  <div className="space-y-3">
                    <StatusDot tone="accent">{t("vocabulary.editingBadge")}</StatusDot>

                    <div className="space-y-1.5">
                      <label htmlFor={`vocab-edit-${index}`} className={labelCls}>
                        {t("vocabulary.editInputLabel")}
                      </label>
                      <input
                        id={`vocab-edit-${index}`}
                        name={`vocab-edit-${index}`}
                        type="text"
                        value={editDraft}
                        onChange={(e) => {
                          setEditDraft(e.target.value);
                          if (editValidationMsg) {
                            setEditValidationMsg("");
                          }
                        }}
                        onKeyDown={handleEditKeyDown}
                        className="field-input"
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={editValidationMsg ? "true" : undefined}
                        autoFocus
                      />

                      {editValidationMsg ? (
                        <p role="alert" aria-live="assertive" className="text-xs text-[var(--red)]">
                          {editValidationMsg}
                        </p>
                      ) : (
                        <p className={hintCls}>{t("vocabulary.editHint")}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary text-xs" onClick={saveEdit}>
                        {t("actions.save")}
                      </button>
                      <button type="button" className="btn btn-ghost text-xs" onClick={cancelEdit}>
                        {t("actions.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1 text-[13px]">
                      <span className="block truncate font-medium text-[var(--text)]" translate="no">
                        {entry.text}
                      </span>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        onClick={() => startEdit(index)}
                        disabled={editingIndex !== null}
                      >
                        {t("actions.edit")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger text-xs"
                        onClick={() => setConfirmIndex(index)}
                        disabled={editingIndex !== null}
                      >
                        {t("actions.delete")}
                      </button>
                    </div>
                  </div>
                )}
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
