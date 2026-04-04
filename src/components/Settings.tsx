import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../stores/settingsStore";
import GeneralTab from "./settings/GeneralTab";
import SttTab from "./settings/SttTab";
import LlmTab from "./settings/LlmTab";
import PromptTab from "./settings/PromptTab";
import VocabularyTab from "./settings/VocabularyTab";
import HistoryTab from "./settings/HistoryTab";

const tabs = ["general", "stt", "llm", "prompt", "vocabulary", "history"] as const;
type Tab = (typeof tabs)[number];

const tabIcons: Record<Tab, string> = {
  general: "⚙",
  stt: "🎙",
  llm: "✨",
  prompt: "📝",
  vocabulary: "📖",
  history: "📋",
};

export default function Settings() {
  const { t } = useTranslation();
  const [active, setActive] = useState<Tab>("general");
  const dirty = useSettingsStore((s) => s.dirty);

  // Warn on close if unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <nav className="w-48 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 flex flex-col gap-1" role="tablist" aria-label="Settings">
        <div className="px-3 py-2 mb-2 text-lg font-bold tracking-tight flex items-center gap-2">
          YATL
          {dirty && <span className="w-2 h-2 rounded-full bg-warning" title={t("actions.unsaved")} />}
        </div>
        {tabs.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            aria-controls={`panel-${tab}`}
            onClick={() => setActive(tab)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
              active === tab
                ? "bg-primary text-white"
                : "hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            <span aria-hidden="true">{tabIcons[tab]}</span>
            <span>{t(`tabs.${tab}`)}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <main id={`panel-${active}`} role="tabpanel" className="flex-1 overflow-y-auto p-6">
        {active === "general" && <GeneralTab />}
        {active === "stt" && <SttTab />}
        {active === "llm" && <LlmTab />}
        {active === "prompt" && <PromptTab />}
        {active === "vocabulary" && <VocabularyTab />}
        {active === "history" && <HistoryTab />}
      </main>
    </div>
  );
}
