import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore } from "../../stores/historyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { AppSettings } from "../../stores/settingsStore";
import { EmptyState, Notice, PageIntro, Section, StatusDot } from "./SettingPrimitives";
import ConfirmDialog from "../ui/ConfirmDialog";

const labelCls = "text-xs font-medium text-(--text-secondary)";
const hintCls = "text-[11px] text-(--text-muted)";

export default function HistoryTab() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const flushSettings = useSettingsStore((s) => s.flushSettings);
  const entries = useHistoryStore((s) => s.entries);
  const loading = useHistoryStore((s) => s.loading);
  const searchQuery = useHistoryStore((s) => s.searchQuery);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);
  const retryEntry = useHistoryStore((s) => s.retryEntry);
  const clearOld = useHistoryStore((s) => s.clearOld);
  const clearAll = useHistoryStore((s) => s.clearAll);
  const retryingId = useHistoryStore((s) => s.retryingId);
  const retryError = useHistoryStore((s) => s.retryError);

  const [query, setQuery] = useState(searchQuery);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "clearAll" } | { type: "delete"; id: string } | { type: "reduceRetention"; newHours: number } | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [draftHours, setDraftHours] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const didMountSearchRef = useRef(false);
  const dtf = useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage || undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }), [i18n.resolvedLanguage]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!didMountSearchRef.current) {
      didMountSearchRef.current = true;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(query);
      void loadHistory();
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, loadHistory, setSearchQuery]);

  const showCustomInput = !!settings && (customMode || ![24, 168, 720].includes(settings.history.retention_hours));
  useEffect(() => {
    if (showCustomInput && settings) {
      setDraftHours(String(settings.history.retention_hours));
    }
  }, [showCustomInput]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!settings) return null;
  const history = settings.history;

  const updateHistory = (patch: Partial<AppSettings["history"]>) => {
    updateSettings({ history: { ...history, ...patch } });
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(null);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopyError(t("history.copyFailedBody"));
      setTimeout(() => setCopyError(null), 2500);
    }
  };

  const trySetRetention = (newHours: number) => {
    if (newHours < history.retention_hours) {
      setConfirmAction({ type: "reduceRetention", newHours });
    } else {
      updateHistory({ retention_hours: newHours });
    }
  };

  const commitDraft = () => {
    const v = parseInt(draftHours, 10);
    if (!Number.isFinite(v) || v < 1 || v > 8760) {
      setDraftHours(String(history.retention_hours));
      return;
    }
    setDraftHours(String(v));
    if (v === history.retention_hours) return;
    if (v < history.retention_hours) {
      setConfirmAction({ type: "reduceRetention", newHours: v });
    } else {
      updateHistory({ retention_hours: v });
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === "clearAll") { void clearAll(); }
    else if (confirmAction.type === "reduceRetention") {
      updateHistory({ retention_hours: confirmAction.newHours });
      setDraftHours(String(confirmAction.newHours));
      await flushSettings();
      void clearOld();
    }
    else { void deleteEntry(confirmAction.id); }
    setConfirmAction(null);
  };

  const confirmMessage =
    confirmAction?.type === "clearAll"
      ? t("history.confirmClearAll")
      : confirmAction?.type === "reduceRetention"
        ? t("history.retentionReduceBody")
        : confirmAction?.type === "delete"
          ? t("history.confirmDelete")
          : "";
  const confirmTitle = confirmAction?.type === "clearAll"
    ? t("history.clearAll")
    : confirmAction?.type === "reduceRetention"
      ? t("history.retentionReduceTitle")
      : confirmAction?.type === "delete"
        ? t("actions.delete")
        : t("actions.confirm");

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow={t("settings.groups.data")}
        title={t("tabs.history")}
        description={t("history.pageDesc")}
      />

      <Section
        title={t("history.controlsTitle")}
        description={t("history.controlsDesc")}
        aside={
          <button
            type="button"
            className="btn btn-danger text-xs"
            title={t("history.controlsDesc")}
            onClick={() => setConfirmAction({ type: "clearAll" })}
          >
            {t("history.clearAll")}
          </button>
        }
      >
        <div className="form-grid">
          <div className="form-block">
            <label className={labelCls}>{t("history.retention")}</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {([
                { key: "retentionPreset1d", hours: 24 },
                { key: "retentionPreset7d", hours: 168 },
                { key: "retentionPreset30d", hours: 720 },
              ] as const).map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`btn btn-compact ${
                    !customMode && history.retention_hours === preset.hours ? "btn-primary" : "btn-ghost"
                  }`}
                  onClick={() => { setCustomMode(false); trySetRetention(preset.hours); }}
                >
                  {t(`history.${preset.key}`)}
                </button>
              ))}
              {customMode || ![24, 168, 720].includes(history.retention_hours) ? (
                <span className="btn btn-compact btn-primary cursor-default gap-1">
                  <input
                    id="retention-hours"
                    name="retention-hours"
                    type="number"
                    value={draftHours}
                    onChange={(e) => setDraftHours(e.target.value)}
                    onBlur={commitDraft}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    className="retention-hours-input bg-transparent text-center text-xs font-medium text-inherit outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label={t("history.retention")}
                    style={{ width: `${Math.max(2, (draftHours || "0").length + 1)}ch` }}
                    min={1}
                    max={8760}
                    step={1}
                    inputMode="numeric"
                    data-testid="retention-hours-input"
                  />
                  <span className="text-xs font-medium">{t("history.hours")}</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-compact btn-ghost"
                  onClick={() => {
                    setDraftHours(String(history.retention_hours));
                    setCustomMode(true);
                  }}
                >
                  {t("history.retentionCustom")}
                </button>
              )}
            </div>
            <p className={hintCls}>{t("history.metrics.retentionHint")}</p>
          </div>

          <div className="form-block">
            <label htmlFor="history-search" className={labelCls}>{t("history.search")}</label>
            <input
              id="history-search"
              name="history-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="field-input"
              placeholder={t("history.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        {history.retention_hours < 24 ? (
          <div className="mt-4 form-support-stack">
            <Notice title={t("history.retentionWarningTitle")} tone="warning">
              {t("history.retentionWarningBody")}
            </Notice>
          </div>
        ) : null}
      </Section>

      {/* Entries */}
      <Section
        title={t("history.resultsTitle")}
        description={t("history.resultsDesc")}
        aside={
          <StatusDot tone={loading ? "accent" : "default"}>
            {loading ? t("status.loading") : `${entries.length} ${t("history.metrics.entries")}`}
          </StatusDot>
        }
      >
        {retryError ? (
          <div role="alert" aria-live="assertive">
            <Notice title={t("history.retryFailed")} tone="danger">
              {retryError}
            </Notice>
          </div>
        ) : null}
        {copyError ? (
          <div role="alert" aria-live="assertive">
            <Notice title={t("history.copyFailedTitle")} tone="danger">
              {copyError}
            </Notice>
          </div>
        ) : null}
        {loading ? (
          <p className="py-4 text-xs text-(--text-muted)">{t("status.loading")}</p>
        ) : entries.length === 0 ? (
          <EmptyState
            title={t("history.noHistory")}
            description={t("history.emptyHint")}
          />
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="group rounded-xl border border-(--border) bg-(--bg-elevated) p-4 transition-colors duration-100 hover:bg-(--bg-muted)"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusDot tone={entry.status === "success" ? "success" : entry.status === "error" ? "danger" : "default"}>
                        {entry.status === "success"
                          ? t("status.done")
                          : entry.status === "error"
                            ? t("status.error")
                            : t("status.loading")}
                      </StatusDot>
                      <span className="text-[11px] text-(--text-muted)">
                        {dtf.format(new Date(entry.created_at))}
                      </span>
                      {entry.duration_seconds > 0 ? (
                        <span className="text-[11px] text-(--text-muted)">{entry.duration_seconds.toFixed(1)}s</span>
                      ) : null}
                    </div>
                    <p className="pre-wrap text-[13px] leading-6 text-(--text-secondary)">
                      {entry.polished_text || entry.raw_text || "-"}
                    </p>
                    {entry.polished_text && entry.raw_text && entry.raw_text !== entry.polished_text ? (
                      <p className="pre-wrap mt-2 text-xs leading-6 text-(--text-muted) line-through">
                        {entry.raw_text}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {(entry.polished_text || entry.raw_text) ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-compact text-xs"
                        title={t("actions.copy")}
                        onClick={() => copyText(entry.id, entry.polished_text || entry.raw_text)}
                      >
                        {copiedId === entry.id ? t("actions.copied") : t("actions.copy")}
                      </button>
                    ) : null}
                    {settings.llm.enabled && entry.raw_text.trim().length > 0 ? (
                      <button
                        type="button"
                        className="btn btn-secondary text-xs"
                        disabled={retryingId === entry.id}
                        title={t("actions.retry")}
                        onClick={() => void retryEntry(entry.id)}
                      >
                        {retryingId === entry.id ? t("status.polishing") : t("actions.retry")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-danger text-xs"
                      title={t("history.confirmDelete")}
                      onClick={() => setConfirmAction({ type: "delete", id: entry.id })}
                    >
                      {t("actions.delete")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmTitle}
        message={confirmMessage}
        tone="danger"
        onConfirm={handleConfirm}
        onCancel={() => {
          if (confirmAction?.type === "reduceRetention") {
            setDraftHours(String(history.retention_hours));
          }
          setConfirmAction(null);
        }}
      />
    </div>
  );
}
