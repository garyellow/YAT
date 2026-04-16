import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "./stores/settingsStore";
import { useRecordingStore } from "./stores/recordingStore";
import { useAppStore } from "./stores/appStore";
import Settings from "./components/Settings";
import i18n from "./lib/i18n";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div className="max-w-xs space-y-2">
            <p className="text-sm font-semibold text-(--text)">
              {i18n.t("errorBoundary.title")}
            </p>
            <p className="text-xs text-(--text-muted)">
              {i18n.t("errorBoundary.message")}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { i18n, t } = useTranslation();
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loading = useSettingsStore((s) => s.loading);
  const settings = useSettingsStore((s) => s.settings);
  const language = useSettingsStore((s) => s.settings?.general.language);
  const theme = useSettingsStore((s) => s.settings?.general.theme);
  const init = useRecordingStore((s) => s.init);
  const loadPlatform = useAppStore((s) => s.loadPlatform);
  const loadPermissions = useAppStore((s) => s.loadPermissions);
  const platformLoaded = useAppStore((s) => s.platformLoaded);
  const permissionsLoaded = useAppStore((s) => s.permissionsLoaded);

  useEffect(() => {
    void loadSettings().catch((error) => {
      console.error("Failed to load settings:", error);
    });
    init();
    void loadPlatform();
    void loadPermissions();
  }, [loadPlatform, loadPermissions, loadSettings, init]);

  useEffect(() => {
    if (language) {
      i18n.changeLanguage(language);
      document.documentElement.lang = language;
    }
  }, [language, i18n]);

  useEffect(() => {
    const root = document.documentElement;
    const setColorScheme = (isDark: boolean) => {
      root.style.colorScheme = isDark ? "dark" : "light";
    };

    if (theme === "dark") {
      root.classList.add("dark");
      setColorScheme(true);
    } else if (theme === "light") {
      root.classList.remove("dark");
      setColorScheme(false);
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const update = () => {
        if (mq.matches) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
        setColorScheme(mq.matches);
      };
      update();
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
  }, [theme]);

  if (loading || !settings || !platformLoaded || !permissionsLoaded) {
    return (
      <div className="loading-screen" aria-live="polite">
        <p className="text-sm text-(--text-muted)">{t("status.loading")}</p>
      </div>
    );
  }

  return (
    <>
      <a href="#settings-content" className="skip-link">
        {t("settings.skipToContent")}
      </a>
      <ErrorBoundary>
        <Settings />
      </ErrorBoundary>
    </>
  );
}
