import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "./stores/settingsStore";
import { useRecordingStore } from "./stores/recordingStore";
import { useAppStore } from "./stores/appStore";
import Settings from "./components/Settings";

export default function App() {
  const { i18n, t } = useTranslation();
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loading = useSettingsStore((s) => s.loading);
  const settings = useSettingsStore((s) => s.settings);
  const language = useSettingsStore((s) => s.settings?.general.language);
  const theme = useSettingsStore((s) => s.settings?.general.theme);
  const init = useRecordingStore((s) => s.init);
  const loadPlatform = useAppStore((s) => s.loadPlatform);
  const platformLoaded = useAppStore((s) => s.platformLoaded);

  useEffect(() => {
    loadSettings();
    init();
    loadPlatform();
  }, [loadPlatform, loadSettings, init]);

  // Sync language
  useEffect(() => {
    if (language) {
      i18n.changeLanguage(language);
      document.documentElement.lang = language;
    }
  }, [language, i18n]);

  // Sync theme
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
      // System
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

  if (loading || !settings || !platformLoaded) {
    return (
      <div className="app-loading-screen" aria-live="polite">
        <div className="app-loading-orb" aria-hidden="true" />
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold tracking-[0.18em] text-primary/80 uppercase">
            YATL
          </p>
          <p className="text-base font-medium text-gray-700 dark:text-gray-200">
            {t("status.loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-root text-gray-900 dark:text-gray-100">
      <a href="#settings-content" className="skip-link">
        Skip to content
      </a>
      <Settings />
    </div>
  );
}
