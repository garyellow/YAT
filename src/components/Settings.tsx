import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { StatusDot } from "./settings/SettingPrimitives";
import { settingsTabs, type SettingsTab } from "./settings/tabs";
import Toast from "./ui/Toast";

type IconName = "overview" | "general" | "stt" | "llm" | "prompt" | "vocabulary" | "history";

const THEME_CYCLE = ["light", "dark", "system"] as const;

function ThemeIcon({ theme }: { theme: string }) {
  const cls = "h-3.5 w-3.5 text-current";
  if (theme === "light") {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2m0 14v2m-9-9h2m14 0h2m-3.64-6.36-1.41 1.41M7.05 16.95l-1.41 1.41m0-12.72 1.41 1.41m9.9 9.9 1.41 1.41" strokeLinecap="round" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.03-.93A5.4 5.4 0 0 1 12 7.5c0-1.62.72-3.08 1.86-4.07A9.06 9.06 0 0 0 12 3Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="12" rx="1.5" />
      <path d="M8 21h8m-4-4v4" strokeLinecap="round" />
    </svg>
  );
}

function NavIcon({ name }: { name: IconName }) {
  const cls = "h-3.5 w-3.5 text-current";

  switch (name) {
    case "overview":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 5.5h16M4 12h16M4 18.5h10" strokeLinecap="round" />
        </svg>
      );
    case "general":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3.75v2.5m0 11.5v2.5m8.25-8.25h-2.5M6.25 12h-2.5m12.1-5.85-1.77 1.77M7.92 16.08l-1.77 1.77m9.7 0-1.77-1.77M7.92 7.92 6.15 6.15" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3.35" />
        </svg>
      );
    case "stt":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="9" y="3.5" width="6" height="11" rx="3" />
          <path d="M6 11.5v.75a6 6 0 0 0 12 0v-.75M12 18.25v2.25M8.75 20.5h6.5" strokeLinecap="round" />
        </svg>
      );
    case "llm":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3.5 14 8l4.5 2-4.5 2-2 4.5-2-4.5L5.5 10 10 8 12 3.5Z" />
        </svg>
      );
    case "prompt":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5.25 6.5h13.5v9.5H9.5l-4.25 3.5V6.5Z" strokeLinejoin="round" />
          <path d="M8.25 10h7.5M8.25 13h5.5" strokeLinecap="round" />
        </svg>
      );
    case "vocabulary":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 5.5h8.75a3.25 3.25 0 0 1 3.25 3.25V18.5H9.25A3.25 3.25 0 0 0 6 21.75V5.5Z" strokeLinejoin="round" />
          <path d="M6 5.5v13A3.25 3.25 0 0 1 9.25 15.25H18" strokeLinecap="round" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8">
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
  const [toastMessage, setToastMessage] = useState("");
  const [toastTone, setToastTone] = useState<"success" | "error">("success");
  const allowCloseRef = useRef(false);
  const settings = useSettingsStore((s) => s.settings);
  const dirty = useSettingsStore((s) => s.dirty);
  const saved = useSettingsStore((s) => s.saved);
  const saveStatus = useSettingsStore((s) => s.saveStatus);
  const lastSaveError = useSettingsStore((s) => s.lastSaveError);
  const validationError = useSettingsStore((s) => s.validationError);
  const flushSettings = useSettingsStore((s) => s.flushSettings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const tabTitle = useMemo(() => t(`tabs.${active}`), [active, t]);
  const sttReady = isSttConfigured(settings);

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
  }, [dirty, saveStatus, settings, validationError, flushSettings, t]);

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
  }, [dirty, flushSettings, saveStatus, t]);

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

  const saveIndicator = useMemo(() => {
    if (validationError) {
      return {
        label: t("settings.fixValidationErrors"),
        className: "text-[var(--red)]",
        title: validationError,
      };
    }

    if (saveStatus === "error") {
      return {
        label: t("settings.autoSaveFailed"),
        className: "text-[var(--red)]",
        title: lastSaveError ?? undefined,
      };
    }

    if (saveStatus === "saving") {
      return {
        label: t("settings.saving"),
        className: "text-[var(--text-secondary)]",
      };
    }

    if (dirty || saveStatus === "pending") {
      return {
        label: t("settings.autoSavePending"),
        className: "text-[var(--text-secondary)]",
      };
    }

    if (saved || saveStatus === "saved") {
      return {
        label: t("settings.allChangesSaved"),
        className: "text-[var(--green)]",
      };
    }

    return {
      label: t("settings.autoSaveActive"),
      className: "text-[var(--text-muted)]",
    };
  }, [dirty, lastSaveError, saveStatus, saved, t, validationError]);

  const saveButtonLabel =
    saveStatus === "saving"
      ? t("settings.saving")
      : saveStatus === "error"
        ? t("actions.retrySave")
        : dirty
          ? t("actions.saveNow")
          : saved
            ? t("actions.saved")
            : t("settings.noChanges");

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
    <div className="shell mx-auto flex max-md:flex-col">
      <Toast message={toastMessage} visible={toastVisible} onDone={hideToast} tone={toastTone} />

      <aside className="sidebar shrink-0 flex flex-col p-3">
        <div className="px-2 pt-2 pb-4">
          <p className="text-[11px] font-medium tracking-widest text-[var(--text-muted)] uppercase">
            YAT
          </p>
        </div>

        <nav className="flex-1 space-y-4" aria-label={t("settings.navigationLabel")}>
          {tabGroups.map((group) => (
            <div key={group.labelKey} className="space-y-0.5">
              <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {t(group.labelKey)}
              </p>
              {group.tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-current={active === tab ? "page" : undefined}
                  onClick={() => setActive(tab)}
                  className="nav-item"
                  data-active={active === tab ? "true" : "false"}
                >
                  <span className="grid h-4 w-4 place-items-center" aria-hidden="true">
                    <NavIcon name={tab} />
                  </span>
                  <span>{t(`tabs.${tab}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] px-2 pt-3 pb-1">
          <StatusDot tone={sttReady ? "success" : "warning"}>
            {sttReady ? t("overview.badges.ready") : t("overview.badges.setupNeeded")}
          </StatusDot>
        </div>
      </aside>

      <section className="min-h-0 min-w-0 flex-1 border-l border-[var(--border)] max-md:border-l-0 max-md:border-t">
        <div className="flex h-full min-h-0 flex-col">
          <header className="main-header flex items-center justify-between gap-4 px-6 py-3">
            <h2 className="text-[14px] font-medium">{tabTitle}</h2>
            <div className="flex items-center gap-3" aria-live="polite">
              <button
                type="button"
                onClick={() => {
                  if (!settings) return;
                  const current = settings.general.theme;
                  const idx = THEME_CYCLE.indexOf(current as typeof THEME_CYCLE[number]);
                  const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
                  updateSettings({ general: { ...settings.general, theme: next } });
                }}
                className="btn btn-ghost flex items-center gap-1.5 px-2"
                title={t(`general.${settings?.general.theme === "light" ? "light" : settings?.general.theme === "dark" ? "dark" : "system"}`)}
                aria-label={t("general.theme")}
              >
                <ThemeIcon theme={settings?.general.theme ?? "system"} />
                <span className="text-xs">{t(`general.${settings?.general.theme === "light" ? "light" : settings?.general.theme === "dark" ? "dark" : "system"}`)}</span>
              </button>
              <span className={`text-xs ${saveIndicator.className}`} title={saveIndicator.title}>
                {saveIndicator.label}
              </span>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saveStatus === "saving" || Boolean(validationError)}
                className={`btn ${dirty ? "btn-primary" : "btn-secondary opacity-50"}`}
                title={validationError ?? lastSaveError ?? t("actions.saveHint")}
              >
                {saveButtonLabel}
              </button>
            </div>
          </header>

          <main id="settings-content" className="flex-1 overflow-y-auto px-6 pb-10 pt-6">
            {renderActivePanel()}
          </main>
        </div>
      </section>
    </div>
  );
}
