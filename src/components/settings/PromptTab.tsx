import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { buildPromptPreview } from "../../lib/settingsFormatters";
import { Notice, SectionCard, StatusPill } from "./SettingPrimitives";
import type { SettingsTab } from "./tabs";

interface PromptTabProps {
  onNavigate?: (tab: SettingsTab) => void;
}

export default function PromptTab({ onNavigate }: PromptTabProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!settings) return null;

  const prompt = settings.prompt;

  const updateSystemPrompt = (system_prompt: string) => {
    updateSettings({ prompt: { ...prompt, system_prompt } });
  };

  const updateUserInstructions = (user_instructions: string) => {
    updateSettings({ prompt: { ...prompt, user_instructions } });
  };

  const appendInstruction = (instruction: string) => {
    const existing = prompt.user_instructions
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (existing.includes(instruction.trim())) return;

    updateUserInstructions([...existing, instruction.trim()].join("\n"));
  };

  const resetToDefault = async () => {
    try {
      const defaultPrompt = await invoke<string>("get_default_prompt");
      updateSystemPrompt(defaultPrompt);
    } catch (error) {
      console.error("Failed to load default prompt:", error);
    }
  };

  const instructionPresets = [
    {
      label: t("prompt.presets.keepToneLabel"),
      value: t("prompt.presets.keepToneValue"),
    },
    {
      label: t("prompt.presets.bulletsLabel"),
      value: t("prompt.presets.bulletsValue"),
    },
    {
      label: t("prompt.presets.formalLabel"),
      value: t("prompt.presets.formalValue"),
    },
    {
      label: t("prompt.presets.meetingLabel"),
      value: t("prompt.presets.meetingValue"),
    },
  ];

  const preview = buildPromptPreview(prompt);

  return (
    <div className="space-y-6">
      {!settings.llm.enabled ? (
        <Notice title={t("prompt.llmDisabledTitle")} tone="warning">
          {t("prompt.llmDisabledBody")}
        </Notice>
      ) : null}

      <Notice title={t("prompt.simpleFirstTitle")} tone="accent">
        {t("prompt.simpleFirstBody")}
      </Notice>

      <SectionCard
        title={t("prompt.userInstructions")}
        description={t("prompt.userInstructionsDesc")}
        aside={
          <StatusPill tone={prompt.user_instructions.trim() ? "accent" : "default"}>
            {prompt.user_instructions.trim() ? t("prompt.customRulesOn") : t("prompt.customRulesOff")}
          </StatusPill>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {instructionPresets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => appendInstruction(preset.value)}
                className="app-button-secondary px-4 py-2 text-xs"
              >
                + {preset.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label htmlFor="user-instructions" className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("prompt.userInstructions")}
            </label>
            <textarea
              id="user-instructions"
              name="user-instructions"
              value={prompt.user_instructions}
              onChange={(e) => updateUserInstructions(e.target.value)}
              rows={8}
              className="app-textarea"
              placeholder={t("prompt.userInstructionsPlaceholder")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                {t("prompt.userInstructionsHint")}
              </p>
              {prompt.user_instructions.trim() ? (
                <button type="button" className="app-button-ghost px-3 py-1.5 text-xs" onClick={() => updateUserInstructions("") }>
                  {t("prompt.clearInstructions")}
                </button>
              ) : null}
            </div>
          </div>

          <Notice title={t("prompt.bestPracticeTitle")} tone="default">
            {t("prompt.bestPracticeBody")}
          </Notice>
        </div>
      </SectionCard>

      <SectionCard
        title={t("prompt.previewTitle")}
        description={t("prompt.previewDesc")}
        aside={<StatusPill tone="default">{t("prompt.previewVocabularyCount", { count: prompt.vocabulary.length })}</StatusPill>}
      >
        <div className="space-y-4">
          <Notice title={t("prompt.previewHintTitle")} tone="default">
            {t("prompt.previewHintBody")}
          </Notice>

          <div className="app-subtle-surface rounded-2xl border border-black/5 p-4 dark:border-white/8">
            <pre className="app-pre-wrap max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-gray-700 dark:text-gray-200">
              {preview}
            </pre>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="app-button-secondary" onClick={() => onNavigate?.("vocabulary") }>
              {t("prompt.openVocabulary")}
            </button>
            <button type="button" className="app-button-ghost" onClick={() => onNavigate?.("llm") }>
              {t("prompt.openPolishSettings")}
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("prompt.advanced")}
        description={t("prompt.systemPromptDesc")}
        aside={<StatusPill tone="warning">{t("prompt.advancedWarningBadge")}</StatusPill>}
      >
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="app-button-ghost"
            aria-expanded={showAdvanced}
            aria-controls="advanced-system-prompt"
          >
            {showAdvanced ? t("prompt.hideAdvanced") : t("prompt.showAdvanced")}
          </button>

          {showAdvanced ? (
            <div id="advanced-system-prompt" className="space-y-4">
              <Notice title={t("prompt.advancedWarningTitle")} tone="warning">
                {t("prompt.advancedWarningBody")}
              </Notice>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="system-prompt" className="text-sm font-medium text-gray-700 dark:text-gray-200">
                    {t("prompt.systemPrompt")}
                  </label>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {t("prompt.charCount", { count: prompt.system_prompt.length })}
                  </span>
                </div>
                <textarea
                  id="system-prompt"
                  name="system-prompt"
                  value={prompt.system_prompt}
                  onChange={(e) => updateSystemPrompt(e.target.value)}
                  rows={16}
                  className="app-textarea font-mono"
                  spellCheck={false}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={resetToDefault} className="app-button-secondary">
                  {t("prompt.resetToDefault")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
