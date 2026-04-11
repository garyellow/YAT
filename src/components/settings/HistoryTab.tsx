import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore } from "../../stores/historyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { AppSettings } from "../../stores/settingsStore";
import { EmptyState, Notice, Section, StatusDot } from "./SettingPrimitives";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

const dtf = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function HistoryTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const entries = useHistoryStore((s) => s.entries);
  const loading = useHistoryStore((s) => s.loading);
  const searchQuery = useHistoryStore((s) => s.searchQuery);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const loadHistory = useHistoryStore((s) => s.loadHistory);
  const deleteEntry = useHistoryStore((s) => s.deleteEntry);
  const retryEntry = useHistoryStore((s) => s.retryEntry);
  const clearOld = useHistoryStore((s) => s.clearOld);
  const retryingId = useHistoryStore((s) => s.retryingId);
  const retryError = useHistoryStore((s) => s.retryError);

  const [query, setQuery] = useState(searchQuery);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const didMountSearchRef = useRef(false);

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

  if (!settings) return null;
  const history = settings.history;

  const updateHistory = (patch: Partial<AppSettings["history"]>) => {
    updateSettings({ history: { ...history, ...patch } });
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard fallback not needed in tauri */
    }
  };

  return (
    <div className="space-y-10">
      <Notice title={t("history.summaryTitle")} tone="accent">
        {t("history.summaryBody")}
      </Notice>

      {/* Retention & Search */}
      <Section title={t("history.controlsTitle")} description={t("history.controlsDesc")}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="retention-hours" className={labelCls}>{t("history.retention")}</label>
              <div className="flex items-center gap-2">
                <input
                  id="retention-hours"
                  name="retention-hours"
                  type="number"
                  value={history.retention_hours}
                  onChange={(e) => updateHistory({ retention_hours: Number(e.target.value) })}
                  className="field-input max-w-28"
                  min={1}
                  max={8760}
                  step={1}
                  inputMode="numeric"
                />
                <span className="text-xs text-[var(--text-muted)]">{t("history.hours")}</span>
              </div>
              <p className={hintCls}>{t("history.metrics.retentionHint")}</p>
            </div>

            <div className="space-y-1.5">
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

          <button
            type="button"
            className="btn btn-danger text-xs"
            onClick={() => {
              if (window.confirm(t("history.confirmClearOld"))) clearOld();
            }}
          >
            {t("history.clearOld")}
          </button>
        </div>
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
          <Notice title={t("history.retryFailed")} tone="danger">
            {retryError}
          </Notice>
        ) : null}
        {loading ? (
          <p className="py-4 text-xs text-[var(--text-muted)]">{t("status.loading")}</p>
        ) : entries.length === 0 ? (
          <EmptyState
            title={t("history.noHistory")}
            description={t("history.emptyHint")}
          />
        ) : (
          <div className="space-y-0">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="group py-3 border-b border-[var(--border)] last:border-b-0 transition-colors duration-100 hover:bg-[var(--bg-subtle)] -mx-2 px-2 rounded"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusDot tone={entry.status === "success" ? "success" : entry.status === "error" ? "danger" : "default"}>
                        {entry.status === "success"
                          ? t("status.done")
                          : entry.status === "error"
                            ? t("status.error")
                            : t("status.loading")}
                      </StatusDot>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {dtf.format(new Date(entry.created_at))}
                      </span>
                      {entry.duration_seconds > 0 ? (
                        <span className="text-[11px] text-[var(--text-muted)]">{entry.duration_seconds.toFixed(1)}s</span>
                      ) : null}
                    </div>
                    <p className="pre-wrap text-[13px] text-[var(--text-secondary)]">
                      {entry.polished_text || entry.raw_text || "-"}
                    </p>
                    {entry.polished_text && entry.raw_text && entry.raw_text !== entry.polished_text ? (
                      <p className="pre-wrap mt-2 text-xs text-[var(--text-muted)] line-through">
                        {entry.raw_text}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-100">
                    {(entry.polished_text || entry.raw_text) ? (
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
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
                        onClick={() => void retryEntry(entry.id)}
                      >
                        {retryingId === entry.id ? t("status.polishing") : t("actions.retry")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-danger text-xs"
                      onClick={() => {
                        if (window.confirm(t("history.confirmDelete"))) {
                          void deleteEntry(entry.id);
                        }
                      }}
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
    </div>
  );
}
