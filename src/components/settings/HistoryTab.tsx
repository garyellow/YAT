import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore, type HistoryEntry } from "../../stores/historyStore";
import { useSettingsStore } from "../../stores/settingsStore";

export default function HistoryTab() {
  const { t } = useTranslation();
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
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (!settings) return null;

  const retention = settings.history.retention_hours;

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold">{t("tabs.history")}</h2>

      {/* Retention & search */}
      <div className="flex items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm">{t("history.retention")}</span>
          <div className="flex items-center gap-2">
            <input
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
              className="w-24 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
              min={1}
              max={8760}
            />
            <span className="text-sm text-gray-500">{t("history.hours")}</span>
            <button
              onClick={() => saveSettings(settings)}
              className="px-3 py-2 rounded-lg bg-primary text-white text-xs font-medium"
            >
              {t("actions.save")}
            </button>
          </div>
        </label>

        <label className="flex-1 flex flex-col gap-1">
          <span className="text-sm">{t("history.search")}</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadHistory()}
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            placeholder={t("history.searchPlaceholder")}
          />
        </label>

        <button
          onClick={() => clearOld()}
          className="px-3 py-2 rounded-lg border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          {t("history.clearOld")}
        </button>
      </div>

      {/* Entries */}
      {loading ? (
        <p className="text-sm text-gray-500">{t("status.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">{t("history.noHistory")}</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry: HistoryEntry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm">{entry.polished_text || entry.raw_text}</p>
                  {entry.polished_text && entry.raw_text !== entry.polished_text && (
                    <p className="text-xs text-gray-500 line-through">
                      {entry.raw_text}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() =>
                      copyText(entry.polished_text || entry.raw_text)
                    }
                    className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                  >
                    {t("actions.copy")}
                  </button>
                  <button
                    onClick={() => retryEntry(entry.id)}
                    className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400"
                  >
                    {t("actions.retry")}
                  </button>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t("actions.delete")}
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                <span>{formatDate(entry.created_at)}</span>
                {entry.duration_seconds > 0 && (
                  <span>{entry.duration_seconds.toFixed(1)}s</span>
                )}
                <span
                  className={
                    entry.status === "success"
                      ? "text-emerald-500"
                      : "text-red-500"
                  }
                >
                  {entry.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
