import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../stores/appStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { EmptyState, Notice, PageIntro, Section, StatusDot } from "./SettingPrimitives";
import ConfirmDialog from "../ui/ConfirmDialog";
import type { SettingsTab } from "./tabs";
import {
  buildVocabularyTransferBundle,
  pickTransferBundle,
  prepareImportedVocabularyBundle,
  saveTransferBundle,
} from "../../lib/settingsTransfer";

const labelCls = "text-xs font-medium text-(--text-secondary)";
const hintCls = "text-[11px] text-(--text-muted)";

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
  onToast?: (message: string, tone?: "success" | "error" | "info") => void;
}

export default function VocabularyTab({ onNavigate, onToast }: VocabularyTabProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const platform = useAppStore((s) => s.platform);

  const [draft, setDraft] = useState("");
  const [validationMsg, setValidationMsg] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editValidationMsg, setEditValidationMsg] = useState("");
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);
  const [transferNotice, setTransferNotice] = useState<{
    tone: "success" | "warning" | "danger";
    title: string;
    lines?: string[];
  } | null>(null);

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
    const duplicates: string[] = [];
    const newEntries = parsedEntries
      .filter((entry) => {
        const key = normalizeEntryKey(entry);
        if (existing.has(key) || seen.has(key)) {
          if (!seen.has(key) && existing.has(key)) duplicates.push(entry);
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((text) => ({ text }));

    if (newEntries.length === 0) {
      setValidationMsg(t("vocabulary.validationDuplicateList", { entries: duplicates.join(", ") }));
      return;
    }

    if (duplicates.length > 0) {
      setValidationMsg(t("vocabulary.validationPartialDuplicate", { entries: duplicates.join(", ") }));
    } else {
      setValidationMsg("");
    }
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

  const handleExportVocabulary = async () => {
    try {
      const savedAs = await saveTransferBundle(buildVocabularyTransferBundle(vocab, platform));
      if (!savedAs) {
        return;
      }

      setTransferNotice({
        tone: "success",
        title: t("vocabulary.transferExportedTitle"),
        lines: [t("vocabulary.transferExportedBody")],
      });
      onToast?.(t("vocabulary.transferExportedToast", { file: savedAs }), "success");
    } catch (error) {
      console.error("Failed to export vocabulary:", error);
      const message = error instanceof Error ? error.message : String(error);
      setTransferNotice({
        tone: "danger",
        title: t("vocabulary.transferFailedTitle"),
        lines: [message],
      });
      onToast?.(message, "error");
    }
  };

  const handleImportVocabulary = async () => {
    try {
      const bundle = await pickTransferBundle();
      if (!bundle) {
        return;
      }

      const plan = prepareImportedVocabularyBundle(bundle, settings);
      if (plan.importedCount === 0) {
        setTransferNotice({
          tone: "warning",
          title: t("vocabulary.transferImportedEmptyTitle"),
          lines: [t("vocabulary.transferImportedEmptyBody")],
        });
        return;
      }

      await saveSettings({
        ...settings,
        prompt: {
          ...settings.prompt,
          vocabulary: plan.vocabulary,
        },
      });

      const lines = [
        t("vocabulary.transferImportedSummary", {
          imported: plan.importedCount,
          added: plan.addedCount,
          skipped: plan.skippedCount,
        }),
      ];

      if (plan.sourcePlatform !== "unknown" && plan.sourcePlatform !== platform) {
        lines.push(t("vocabulary.transferCrossPlatformBody"));
      }

      setTransferNotice({
        tone: plan.addedCount > 0 ? "success" : "warning",
        title: plan.addedCount > 0
          ? t("vocabulary.transferImportedTitle")
          : t("vocabulary.transferImportedNoChangeTitle"),
        lines,
      });
      onToast?.(
        plan.addedCount > 0
          ? t("vocabulary.transferImportedToast", { count: plan.addedCount })
          : t("vocabulary.transferImportedNoChangeToast"),
        plan.addedCount > 0 ? "success" : "info",
      );
    } catch (error) {
      console.error("Failed to import vocabulary:", error);
      const message = error instanceof Error ? error.message : String(error);
      setTransferNotice({
        tone: "danger",
        title: t("vocabulary.transferFailedTitle"),
        lines: [message],
      });
      onToast?.(message, "error");
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
              <p role="alert" aria-live="assertive" className="text-xs text-(--red)">{validationMsg}</p>
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
                className="group rounded-xl border border-(--border) bg-(--bg-elevated) px-4 py-3 transition-colors duration-100 hover:bg-(--bg-muted)"
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
                        <p role="alert" aria-live="assertive" className="text-xs text-(--red)">
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
                      <span className="block truncate font-medium text-(--text)" translate="no">
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

      <Section title={t("vocabulary.transferTitle")} description={t("vocabulary.transferDesc")}>
        <div className="space-y-4">
          <Notice title={t("vocabulary.transferNoticeTitle")} tone="default">
            <div className="space-y-2">
              <p>{t("vocabulary.transferNoticeBody")}</p>
              <p>{t("vocabulary.transferCrossPlatformBody")}</p>
            </div>
          </Notice>

          <div className="grid gap-3 md:grid-cols-2">
            <button type="button" className="option-btn text-left" onClick={() => void handleExportVocabulary()}>
              <div className="min-w-0">
                <span className="text-[13px] font-semibold text-(--text)">{t("vocabulary.transferExportCardTitle")}</span>
                <p className="mt-1 text-xs leading-5 text-(--text-secondary)">{t("vocabulary.transferExportCardBody")}</p>
                <div className="pt-3">
                  <span className="btn btn-primary text-xs">{t("vocabulary.transferExportAction")}</span>
                </div>
              </div>
            </button>

            <button type="button" className="option-btn text-left" onClick={() => void handleImportVocabulary()}>
              <div className="min-w-0">
                <span className="text-[13px] font-semibold text-(--text)">{t("vocabulary.transferImportCardTitle")}</span>
                <p className="mt-1 text-xs leading-5 text-(--text-secondary)">{t("vocabulary.transferImportCardBody")}</p>
                <div className="pt-3">
                  <span className="btn btn-secondary text-xs">{t("vocabulary.transferImportAction")}</span>
                </div>
              </div>
            </button>
          </div>

          {transferNotice ? (
            <Notice title={transferNotice.title} tone={transferNotice.tone}>
              {transferNotice.lines?.length ? (
                <ul className="list-disc space-y-1 pl-5">
                  {transferNotice.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          ) : null}
        </div>
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
