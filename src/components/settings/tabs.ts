export const settingsTabs = [
  "overview",
  "general",
  "stt",
  "llm",
  "prompt",
  "vocabulary",
  "history",
] as const;

export type SettingsTab = (typeof settingsTabs)[number];
