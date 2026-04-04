import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore, type HistoryEntry } from "../../stores/historyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { EmptyState, Notice, SectionCard, StatCard, StatusPill } from "./SettingPrimitives";

export default function HistoryTab() {
  const { t, i18n } = useTranslation();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const {
    entries,
    loading,
    searchQuery,
    setSearchQuery,
    loadHistory,
    deleteEntry,
    retryEntry,
    clearOld,
  } = useHistoryStore();

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Debounced search: reload history 400ms after user stops typing
  useEffect(() => {
    if (searchQuery === "") return;
    const timer = setTimeout(() => loadHistory(), 400);
    return () => clearTimeout(timer);
  }, [searchQuery, loadHistory]);

  if (!settings) return null;

  const retention = settings.history.retention_hours;

  const copyText = (text: string, id: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch((e) => {
      console.error("clipboard write failed:", e);
    });
  };

  const formatter = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="space-y-6">
      <Notice title={t("history.summaryTitle")} tone="accent">
        {t("history.summaryBody")}
      </Notice>

      <div className="app-metric-grid">
        <StatCard
          label={t("history.metrics.entries")}
          value={String(entries.length)}
          hint={searchQuery ? t("history.metrics.filtered") : t("history.metrics.all")}
          tone="accent"
        />
        <StatCard
          label={t("history.metrics.retention")}
          value={`${retention}${t("history.hours")}`}
          hint={t("history.metrics.retentionHint")}
          tone="default"
        />
      </div>

      <SectionCard title={t("history.controlsTitle")} description={t("history.controlsDesc")}>
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.4fr)_auto] lg:items-end">
          <div className="space-y-2">
            <label htmlFor="history-retention" className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("history.retention")}
            </label>
            <div className="flex items-center gap-3">
              <input
                id="history-retention"
                name="history-retention"
                type="number"
                value={retention}
                onChange={(e) =>
                  updateSettings({
                    history: {
                      ...settings.history,
                      retention_hours: Number(e.target.value),
                    },
                  })
                }
                className="app-input max-w-36"
                min={1}
                max={8760}
                step={1}
                inputMode="numeric"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">{t("history.hours")}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="history-search" className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("history.search")}
            </label>
            <div className="flex gap-2">
              <input
                id="history-search"
                name="history-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadHistory()}
                className="app-input"
                placeholder={t("history.searchPlaceholder")}
                autoComplete="off"
              />
              <button onClick={() => loadHistory()} className="app-button-secondary shrink-0">
                {t("history.searchButton")}
              </button>
            </div>
          </div>

          <button onClick={() => clearOld()} className="app-button-danger shrink-0">
            {t("history.clearOld")}
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title={t("history.resultsTitle")}
        description={t("history.resultsDesc")}
        aside={<StatusPill tone={loading ? "accent" : "default"}>{loading ? t("status.loading") : t("history.resultsReady")}</StatusPill>}
      >
        {loading ? (
          <Notice title={t("history.loadingTitle")} tone="default">
            {t("status.loading")}
          </Notice>
        ) : entries.length === 0 ? (
          <EmptyState icon="📝" title={t("history.noHistory")} description={t("history.emptyHint")} />
        ) : (
          <div className="space-y-3">
            {entries.map((entry: HistoryEntry) => (
              <div key={entry.id} className="app-subtle-surface rounded-2xl border border-black/5 p-4 dark:border-white/8">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm leading-7 text-gray-800 dark:text-gray-100">
                      {entry.polished_text || entry.raw_text}
                    </p>
                    {entry.polished_text && entry.raw_text !== entry.polished_text ? (
                      <p className="text-xs leading-6 text-gray-500 line-through dark:text-gray-400">
                        {entry.raw_text}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button onClick={() => copyText(entry.polished_text || entry.raw_text, entry.id)} className="app-button-ghost px-3 py-1.5 text-xs">
                      {copiedId === entry.id ? t("actions.copied") : t("actions.copy")}
                    </button>
                    <button onClick={() => retryEntry(entry.id)} className="app-button-secondary px-3 py-1.5 text-xs">
                      {t("actions.retry")}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(t("history.confirmDelete"))) {
                          void deleteEntry(entry.id);
                        }
                      }}
                      className="app-button-danger px-3 py-1.5 text-xs"
                    >
                      {t("actions.delete")}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{formatter.format(new Date(entry.created_at))}</span>
                  {entry.duration_seconds > 0 ? <span>{entry.duration_seconds.toFixed(1)}s</span> : null}
                  <StatusPill tone={entry.status === "success" ? "success" : "danger"}>{entry.status}</StatusPill>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
