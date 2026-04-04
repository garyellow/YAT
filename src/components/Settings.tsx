import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";
import { useRecordingStore } from "../stores/recordingStore";
import { formatHotkeyCombo, isLlmConfigured, isSttConfigured } from "../lib/settingsFormatters";
import OverviewTab from "./settings/OverviewTab";
import GeneralTab from "./settings/GeneralTab";
import SttTab from "./settings/SttTab";
import LlmTab from "./settings/LlmTab";
import PromptTab from "./settings/PromptTab";
import VocabularyTab from "./settings/VocabularyTab";
import HistoryTab from "./settings/HistoryTab";
import { StatusPill } from "./settings/SettingPrimitives";
import { settingsTabs, type SettingsTab } from "./settings/tabs";
import Toast from "./ui/Toast";

type IconName = "overview" | "general" | "stt" | "llm" | "prompt" | "vocabulary" | "history";

function SidebarIcon({ name, active }: { name: IconName; active: boolean }) {
  const cls = active ? "text-white" : "text-gray-500 dark:text-gray-300";

  switch (name) {
    case "overview":
      return (
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${cls}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 5.5h16M4 12h16M4 18.5h10" strokeLinecap="round" />
          <circle cx="18" cy="18.5" r="2.5" />
        </svg>
      );
    case "general":
      return (
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${cls}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3.75v2.5m0 11.5v2.5m8.25-8.25h-2.5M6.25 12h-2.5m12.1-5.85-1.77 1.77M7.92 16.08l-1.77 1.77m9.7 0-1.77-1.77M7.92 7.92 6.15 6.15" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3.35" />
        </svg>
      );
    case "stt":
      return (
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${cls}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="9" y="3.5" width="6" height="11" rx="3" />
          <path d="M6 11.5v.75a6 6 0 0 0 12 0v-.75M12 18.25v2.25M8.75 20.5h6.5" strokeLinecap="round" />
        </svg>
      );
    case "llm":
      return (
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${cls}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3.5 14 8l4.5 2-4.5 2-2 4.5-2-4.5L5.5 10 10 8 12 3.5Z" />
        </svg>
      );
    case "prompt":
      return (
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${cls}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5.25 6.5h13.5v9.5H9.5l-4.25 3.5V6.5Z" strokeLinejoin="round" />
          <path d="M8.25 10h7.5M8.25 13h5.5" strokeLinecap="round" />
        </svg>
      );
    case "vocabulary":
      return (
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${cls}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 5.5h8.75a3.25 3.25 0 0 1 3.25 3.25V18.5H9.25A3.25 3.25 0 0 0 6 21.75V5.5Z" strokeLinejoin="round" />
          <path d="M6 5.5v13A3.25 3.25 0 0 1 9.25 15.25H18" strokeLinecap="round" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${cls}`} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 6.25v6l3.75 2.25" strokeLinecap="round" />
          <path d="M4.75 12a7.25 7.25 0 1 0 2.12-5.13" strokeLinecap="round" />
          <path d="M4.75 4.75v3.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

const tabGroups: Array<{ labelKey: string; tabs: SettingsTab[] }> = [
  { labelKey: "settings.groups.workspace", tabs: ["overview"] },
  { labelKey: "settings.groups.capture", tabs: ["general", "stt", "llm"] },
  { labelKey: "settings.groups.customize", tabs: ["prompt", "vocabulary"] },
  { labelKey: "settings.groups.data", tabs: ["history"] },
];

export default function Settings() {
  const { t } = useTranslation();
  const [active, setActive] = useState<SettingsTab>("overview");
  const [toastVisible, setToastVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const settings = useSettingsStore((s) => s.settings);
  const dirty = useSettingsStore((s) => s.dirty);
  const saved = useSettingsStore((s) => s.saved);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const recordingStatus = useRecordingStore((s) => s.status);

  const currentTabMeta = useMemo(
    () => ({
      title: t(`tabs.${active}`),
      description: t(`settings.tabDescriptions.${active}`),
    }),
    [active, t]
  );

  const sttReady = isSttConfigured(settings);
  const llmReady = isLlmConfigured(settings);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (fromUrl && settingsTabs.includes(fromUrl as SettingsTab)) {
      setActive(fromUrl as SettingsTab);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", active);
    window.history.replaceState({}, "", url);
  }, [active]);

  // Warn on close if unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!isSaving && dirty && settings) {
          setIsSaving(true);
          void saveSettings(settings).then(() => {
            setToastVisible(true);
          }).finally(() => setIsSaving(false));
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, isSaving, saveSettings, settings]);

  const handleSave = () => {
    if (settings && dirty && !isSaving) {
      setIsSaving(true);
      void saveSettings(settings).then(() => {
        setToastVisible(true);
      }).finally(() => setIsSaving(false));
    }
  };

  const hideToast = useCallback(() => setToastVisible(false), []);

  const renderActivePanel = () => {
    const panel = (() => {
      switch (active) {
        case "overview":
          return <OverviewTab onNavigate={setActive} />;
        case "general":
          return <GeneralTab />;
        case "stt":
          return <SttTab />;
        case "llm":
          return <LlmTab />;
        case "prompt":
          return <PromptTab onNavigate={setActive} />;
        case "vocabulary":
          return <VocabularyTab />;
        case "history":
          return <HistoryTab />;
        default:
          return null;
      }
    })();
    return (
      <div key={active} className="tab-enter">
        {panel}
      </div>
    );
  };

  return (
    <div className="app-shell mx-auto flex gap-5 max-xl:flex-col">
      <Toast message={t("actions.saveSuccess")} visible={toastVisible} onDone={hideToast} />
      <aside className="app-sidebar-panel shrink-0 rounded-[28px] border border-black/5 p-4 backdrop-blur-xl dark:border-white/8">
        <div className="flex h-full flex-col gap-5">
          <div className="app-card border-none bg-white/70 px-5 py-5 dark:bg-slate-950/50">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">YATL</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("app.name")}</h1>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {t("app.desc")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2" aria-live="polite">
                <StatusPill tone={dirty ? "warning" : saved ? "success" : "default"}>
                  {dirty ? t("actions.unsaved") : saved ? t("actions.saved") : t("settings.allChangesSaved")}
                </StatusPill>
                <StatusPill tone={recordingStatus === "error" ? "danger" : recordingStatus === "idle" ? "default" : "accent"}>
                  {t(`status.${recordingStatus}`)}
                </StatusPill>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-4" aria-label={t("settings.navigationLabel")}>
            {tabGroups.map((group) => (
              <div key={group.labelKey} className="space-y-2">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">
                  {t(group.labelKey)}
                </p>
                <div className="space-y-1.5">
                  {group.tabs.map((tab) => {
                    const selected = active === tab;

                    return (
                      <button
                        key={tab}
                        type="button"
                        aria-current={selected ? "page" : undefined}
                        onClick={() => setActive(tab)}
                        className="app-nav-item w-full"
                        data-active={selected ? "true" : "false"}
                      >
                        <span className="app-nav-icon" aria-hidden="true">
                          <SidebarIcon name={tab} active={selected} />
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block text-sm font-semibold tracking-tight">
                            {t(`tabs.${tab}`)}
                          </span>
                          <span className="app-nav-desc mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                            {t(`settings.navDescriptions.${tab}`)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="app-card border-none bg-white/65 px-4 py-4 dark:bg-slate-950/45">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={sttReady ? "success" : "warning"}>{t("settings.sidebarSpeech")}</StatusPill>
                <StatusPill tone={llmReady ? "accent" : "warning"}>{t("settings.sidebarPolish")}</StatusPill>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                  {t("settings.quickSummary")}
                </p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t("settings.hotkeySummary", { key: formatHotkeyCombo(settings?.general.hotkey ?? { hotkey_type: "single", key: "Alt", modifier: null, double_tap_interval_ms: 300 }) })}
                </p>
                <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {settings?.general.output_mode === "auto_paste"
                    ? t("settings.outputAutoPasteSummary")
                    : t("settings.outputClipboardSummary")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <section className="app-workspace-panel min-h-0 min-w-0 flex-1 rounded-[30px] border border-black/5 backdrop-blur-xl dark:border-white/8">
        <div className="flex h-full min-h-0 flex-col">
          <header className="app-workspace-header sticky top-0 z-10 flex flex-col gap-4 border-b border-black/5 px-6 py-5 backdrop-blur-xl dark:border-white/8 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="space-y-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                {t("settings.windowLabel")}
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">{currentTabMeta.title}</h2>
              <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                {currentTabMeta.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end" aria-live="polite">
              <StatusPill tone={dirty ? "warning" : saved ? "success" : "default"}>
                {dirty ? t("actions.unsaved") : saved ? t("actions.saved") : t("settings.allChangesSaved")}
              </StatusPill>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty}
                className={dirty ? "app-button-primary" : "app-button-secondary opacity-70"}
                title={t("actions.saveHint")}
              >
                {dirty ? t("actions.save") : saved ? `✓ ${t("actions.saved")}` : t("settings.noChanges")}
              </button>
            </div>
          </header>

          <main id="settings-content" className="flex-1 overflow-y-auto px-6 pb-8 pt-6 lg:px-8">
            {renderActivePanel()}
          </main>
        </div>
      </section>
    </div>
  );
}
