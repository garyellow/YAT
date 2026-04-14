import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";
import { isSttConfigured } from "../lib/settingsFormatters";
import { isTauriRuntime } from "../lib/tauriRuntime";
import OverviewTab from "./settings/OverviewTab";
import GeneralTab from "./settings/GeneralTab";
import SttTab from "./settings/SttTab";
import LlmTab from "./settings/LlmTab";
import PromptTab from "./settings/PromptTab";
import VocabularyTab from "./settings/VocabularyTab";
import HistoryTab from "./settings/HistoryTab";
import { SettingsTabIcon, AppTitleImage } from "./settings/icons";
import { Notice, StatusDot } from "./settings/SettingPrimitives";
import { settingsTabs, type SettingsTab } from "./settings/tabs";
import Toast from "./ui/Toast";

const THEME_CYCLE = ["system", "light", "dark"] as const;
const LANGUAGE_CYCLE = ["zh-TW", "en"] as const;

type ThemeSetting = (typeof THEME_CYCLE)[number];
type LanguageSetting = (typeof LANGUAGE_CYCLE)[number];

function ThemeIcon({ theme }: { theme: string }) {
  const cls = "h-3.5 w-3.5 text-current";
  if (theme === "light") {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2m0 14v2m-9-9h2m14 0h2m-3.64-6.36-1.41 1.41M7.05 16.95l-1.41 1.41m0-12.72 1.41 1.41m9.9 9.9 1.41 1.41" strokeLinecap="round" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.03-.93A5.4 5.4 0 0 1 12 7.5c0-1.62.72-3.08 1.86-4.07A9.06 9.06 0 0 0 12 3Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="12" rx="1.5" />
      <path d="M8 21h8m-4-4v4" strokeLinecap="round" />
    </svg>
  );
}

function LanguageIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="h-3.5 w-3.5 text-current" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3.75a8.25 8.25 0 1 0 0 16.5 8.25 8.25 0 0 0 0-16.5Z" />
      <path d="M4.5 12h15M12 4c1.9 2.1 3 4.92 3 8s-1.1 5.9-3 8c-1.9-2.1-3-4.92-3-8s1.1-5.9 3-8Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const tabGroups: Array<{ labelKey: string; tabs: SettingsTab[] }> = [
  { labelKey: "settings.groups.workspace", tabs: ["overview"] },
  { labelKey: "settings.groups.capture", tabs: ["general", "stt", "llm"] },
  { labelKey: "settings.groups.customize", tabs: ["prompt", "vocabulary"] },
  { labelKey: "settings.groups.data", tabs: ["history"] },
];

function getTabFromLocation(): SettingsTab {
  const fromUrl = new URLSearchParams(window.location.search).get("tab");
  return fromUrl && settingsTabs.includes(fromUrl as SettingsTab)
    ? (fromUrl as SettingsTab)
    : "overview";
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState<SettingsTab>("overview");
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<"success" | "error" | "info">("success");
  const allowCloseRef = useRef(false);
  const settings = useSettingsStore((s) => s.settings);
  const dirty = useSettingsStore((s) => s.dirty);
  const saveStatus = useSettingsStore((s) => s.saveStatus);
  const lastSaveError = useSettingsStore((s) => s.lastSaveError);
  const validationError = useSettingsStore((s) => s.validationError);
  const flushSettings = useSettingsStore((s) => s.flushSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const platform = useAppStore((s) => s.platform);

  const tabTitle = t(`tabs.${active}`);
  const sttReady = isSttConfigured(settings);
  const currentTheme: ThemeSetting = settings?.general.theme === "light" || settings?.general.theme === "dark"
    ? settings.general.theme
    : "system";
  const currentLanguage: LanguageSetting = settings?.general.language === "en" ? "en" : "zh-TW";
  const statusAreaLabel = platform === "macos"
    ? t("general.statusAreaMacos")
    : t("general.statusAreaDefault");

  useEffect(() => {
    const syncFromLocation = () => {
      const nextTab = getTabFromLocation();
      setActive(nextTab);

      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") !== nextTab) {
        url.searchParams.set("tab", nextTab);
        window.history.replaceState({ tab: nextTab }, "", url);
      }
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const changeTab = useCallback((nextTab: SettingsTab) => {
    const url = new URL(window.location.href);
    if (active === nextTab && url.searchParams.get("tab") === nextTab) {
      return;
    }

    url.searchParams.set("tab", nextTab);
    window.history.pushState(
      { tab: nextTab },
      "",
      url,
    );
    setActive(nextTab);
  }, [active]);

  useEffect(() => {
    const handler = () => {
      if (dirty) {
        void flushSettings().catch(() => {});
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, flushSettings]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && dirty) {
        void flushSettings().catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [dirty, flushSettings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (saveStatus !== "saving" && dirty && settings && !validationError) {
          void flushSettings()
            .then(() => {
              setToastTone("success");
              setToastMessage(t("actions.saveSuccess"));
              setToastVisible(true);
            })
            .catch((error) => {
              console.error("Failed to save settings:", error);
              setToastTone("error");
              setToastMessage(
                `${t("actions.saveFailed")}: ${error instanceof Error ? error.message : String(error)}`
              );
              setToastVisible(true);
            });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, saveStatus, settings, validationError, flushSettings, t, i18n.resolvedLanguage]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();

      unlisten = await currentWindow.onCloseRequested(async (event) => {
        if (allowCloseRef.current) {
          allowCloseRef.current = false;
          return;
        }

        if (!dirty && saveStatus !== "saving") {
          return;
        }

        event.preventDefault();

        try {
          await flushSettings();
          allowCloseRef.current = true;
          await currentWindow.close();
        } catch (error) {
          setToastTone("error");
          setToastMessage(
            `${t("settings.closeSaveBlocked")}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          setToastVisible(true);
        }
      });

      if (disposed) {
        unlisten?.();
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [dirty, flushSettings, saveStatus, t, i18n.resolvedLanguage]);

  // Show a one-time toast when the window first hides to tray
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("close-to-tray-hint", () => {
        setToastTone("info");
        setToastMessage(t("general.closeToTrayNotice", { place: statusAreaLabel }));
        setToastVisible(true);
      });
      if (disposed) unlisten?.();
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [statusAreaLabel, t, i18n.resolvedLanguage]);

  const handleSave = async () => {
    if (dirty && saveStatus !== "saving" && !validationError) {
      try {
        await flushSettings();
        setToastTone("success");
        setToastMessage(t("actions.saveSuccess"));
        setToastVisible(true);
      } catch (error) {
        console.error("Failed to save settings:", error);
        setToastTone("error");
        setToastMessage(
          `${t("actions.saveFailed")}: ${error instanceof Error ? error.message : String(error)}`
        );
        setToastVisible(true);
      }
    }
  };

  const hideToast = useCallback(() => setToastVisible(false), []);

  const saveIndicator = (() => {
    if (validationError) {
      return {
        label: t("settings.fixValidationErrors"),
        tone: "warning" as const,
        title: t("settings.validationNoticeTitle"),
      };
    }

    if (saveStatus === "error") {
      return {
        label: t("settings.autoSaveFailed"),
        tone: "danger" as const,
        title: t("settings.autoSaveFailedDetailBody", {
          error: lastSaveError ?? t("settings.unknownSaveError"),
        }),
      };
    }

    return null;
  })();

  const statusNotice = validationError && active !== "general"
    ? {
        tone: "warning" as const,
        title: t("settings.validationNoticeTitle"),
        body: <p className="leading-5">{t("settings.validationNoticeBody")}</p>,
      }
    : saveStatus === "error"
      ? {
          tone: "danger" as const,
          title: t("settings.autoSaveFailedDetailTitle"),
          body: (
            <div className="space-y-3">
              <p className="leading-5">
                {t("settings.autoSaveFailedDetailBody", {
                  error: lastSaveError ?? t("settings.unknownSaveError"),
                })}
              </p>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => void handleSave()}
              >
                {t("actions.retrySave")}
              </button>
            </div>
          ),
        }
      : null;

  const cycleTheme = () => {
    if (!settings) return;
    const idx = THEME_CYCLE.indexOf(currentTheme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    updateSettings({ general: { ...settings.general, theme: next } });
  };

  const cycleLanguage = () => {
    if (!settings) return;
    const idx = LANGUAGE_CYCLE.indexOf(currentLanguage);
    const next = LANGUAGE_CYCLE[(idx + 1) % LANGUAGE_CYCLE.length];
    updateSettings({ general: { ...settings.general, language: next } });
    void i18n.changeLanguage(next);
  };

  const themeLabel = t(`general.${currentTheme}`);
  const languageLabel = currentLanguage === "zh-TW"
    ? t("general.languageTraditionalChineseShort")
    : t("general.languageEnglishShort");
  const languageTitle = currentLanguage === "zh-TW"
    ? t("general.languageTraditionalChinese")
    : t("general.languageEnglish");

  const renderActivePanel = () => {
    const panel = (() => {
      switch (active) {
        case "overview":
          return <OverviewTab onNavigate={changeTab} />;
        case "general":
          return <GeneralTab />;
        case "stt":
          return <SttTab />;
        case "llm":
          return <LlmTab />;
        case "prompt":
          return <PromptTab onNavigate={changeTab} />;
        case "vocabulary":
          return <VocabularyTab onNavigate={changeTab} />;
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
    <div className="shell flex max-lg:flex-col">
      <Toast message={toastMessage} visible={toastVisible} onDone={hideToast} tone={toastTone} />

      <aside className="sidebar shrink-0 flex flex-col p-3">
        <div className="sidebar-brand flex items-center gap-2.5 px-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
             <AppTitleImage className="h-full w-full object-cover" />
          </div>
          <p className="text-xl font-bold tracking-[-0.02em] text-[var(--text)]">YAT</p>
        </div>

        <nav className="flex-1 space-y-5 px-1 pt-4" aria-label={t("settings.navigationLabel")}>
          {tabGroups.map((group) => (
            <div key={group.labelKey} className="nav-group">
              <p className="nav-group-label">
                {t(group.labelKey)}
              </p>
              {group.tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-current={active === tab ? "page" : undefined}
                  onClick={() => changeTab(tab)}
                  className="nav-item"
                  data-active={active === tab ? "true" : "false"}
                >
                  <span className="grid h-4 w-4 place-items-center" aria-hidden="true">
                    <SettingsTabIcon name={tab} className="h-3.5 w-3.5" />
                  </span>
                  <span>{t(`tabs.${tab}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <StatusDot tone={sttReady ? "success" : "warning"}>
            {sttReady ? t("overview.badges.ready") : t("overview.badges.setupNeeded")}
          </StatusDot>
          <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">
            {sttReady
              ? t("overview.summary.speechReady", { model: settings?.stt.model ?? "" })
              : t("overview.summary.speechPending")}
          </p>
        </div>
      </aside>

      <section className="main-pane min-h-0 flex flex-col">
        <div className="flex h-full min-h-0 flex-col">
          <header className="main-header flex items-center justify-between gap-4 px-7 py-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                YAT
              </p>
              <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
                {tabTitle}
              </h2>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2" aria-live="polite">
              <button
                type="button"
                onClick={cycleTheme}
                className="toolbar-chip"
                title={`${t("general.theme")}: ${themeLabel}`}
                aria-label={`${t("general.theme")}: ${themeLabel}`}
              >
                <ThemeIcon theme={currentTheme} />
                <span className="text-xs whitespace-nowrap">{themeLabel}</span>
              </button>

              <button
                type="button"
                onClick={cycleLanguage}
                className="toolbar-chip"
                title={`${t("general.language")}: ${languageTitle}`}
                aria-label={`${t("general.language")}: ${languageTitle}`}
              >
                <LanguageIcon />
                <span className="text-xs whitespace-nowrap" translate="no">{languageLabel}</span>
              </button>

              {saveIndicator && (
                <span
                  className="status-pill"
                  data-tone={saveIndicator.tone}
                  title={saveIndicator.title}
                >
                  <span className="dot" data-tone={saveIndicator.tone} />
                  <span className="text-xs font-medium whitespace-nowrap">{saveIndicator.label}</span>
                </span>
              )}
            </div>
          </header>

          <main id="settings-content" className="page-scroll flex-1 overflow-y-auto">
            <div className="page-frame">
              {statusNotice ? (
                <div className="mb-6">
                  <Notice title={statusNotice.title} tone={statusNotice.tone}>
                    {statusNotice.body}
                  </Notice>
                </div>
              ) : null}
              {renderActivePanel()}
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}
