import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "./stores/settingsStore";
import { useRecordingStore } from "./stores/recordingStore";
import Settings from "./components/Settings";

export default function App() {
  const { i18n } = useTranslation();
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const language = useSettingsStore((s) => s.settings?.general.language);
  const theme = useSettingsStore((s) => s.settings?.general.theme);
  const init = useRecordingStore((s) => s.init);

  useEffect(() => {
    loadSettings();
    init();
  }, [loadSettings, init]);

  // Sync language
  useEffect(() => {
    if (language) i18n.changeLanguage(language);
  }, [language, i18n]);

  // Sync theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      // System
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const update = () =>
        mq.matches ? root.classList.add("dark") : root.classList.remove("dark");
      update();
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
  }, [theme]);

  return (
    <div className="h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 no-select">
      <Settings />
    </div>
  );
}
