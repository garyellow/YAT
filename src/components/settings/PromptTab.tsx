import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { buildPromptPreview } from "../../lib/settingsFormatters";
import { Notice, Section } from "./SettingPrimitives";
import type { SettingsTab } from "./tabs";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

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

  const update = (patch: Partial<typeof prompt>) => {
    updateSettings({ prompt: { ...prompt, ...patch } });
  };

  const previewText = buildPromptPreview(prompt);
  const llmDisabled = !settings.llm.enabled;

  const insertPreset = (preset: string) => {
    const current = prompt.user_instructions;
    const sep = current.trim().length > 0 ? "\n" : "";
    update({ user_instructions: current + sep + preset });
  };

  const resetSystemPrompt = async () => {
    try {
      const defaultPrompt = await invoke<string>("get_default_prompt");
      update({ system_prompt: defaultPrompt });
    } catch (e) {
      console.error("Failed to get default prompt:", e);
    }
  };

  const presets = [
    { key: "keepTone", label: t("prompt.presets.keepToneLabel"), value: t("prompt.presets.keepToneValue") },
    { key: "bullets", label: t("prompt.presets.bulletsLabel"), value: t("prompt.presets.bulletsValue") },
    { key: "formal", label: t("prompt.presets.formalLabel"), value: t("prompt.presets.formalValue") },
    { key: "meeting", label: t("prompt.presets.meetingLabel"), value: t("prompt.presets.meetingValue") },
  ];

  return (
    <div className="space-y-10">
      {llmDisabled ? (
        <Notice title={t("prompt.llmDisabledTitle")} tone="warning">
          {t("prompt.llmDisabledBody")}
        </Notice>
      ) : null}

      <Notice title={t("prompt.simpleFirstTitle")} tone="accent">
        {t("prompt.simpleFirstBody")}
      </Notice>

      {/* User Instructions */}
      <Section title={t("prompt.userInstructions")} description={t("prompt.userInstructionsDesc")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => insertPreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="user-instructions" className={labelCls}>{t("prompt.userInstructions")}</label>
            <textarea
              id="user-instructions"
              name="user-instructions"
              value={prompt.user_instructions}
              onChange={(e) => update({ user_instructions: e.target.value })}
              className="field-textarea"
              placeholder={t("prompt.userInstructionsPlaceholder")}
              rows={5}
            />
            <div className="flex items-center justify-between">
              <p className={hintCls}>{t("prompt.userInstructionsHint")}</p>
              {prompt.user_instructions.trim().length > 0 ? (
                <button type="button" className="btn btn-ghost text-xs" onClick={() => update({ user_instructions: "" })}>
                  {t("prompt.clearInstructions")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Section>

      {/* Preview */}
      <Section
        title={t("prompt.previewTitle")}
        description={t("prompt.previewDesc")}
        aside={
          <span className="text-xs text-[var(--text-muted)]">
            {t("prompt.charCount", { count: previewText.length })}
          </span>
        }
      >
        <div className="space-y-3">
          <div className="rounded bg-[var(--bg-subtle)] p-3">
            <pre className="pre-wrap max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
              {previewText}
            </pre>
          </div>
          <div className="flex gap-2">
            {onNavigate ? (
              <>
                <button className="btn btn-ghost text-xs" onClick={() => onNavigate("vocabulary")}>
                  {t("prompt.openVocabulary")}
                </button>
                <button className="btn btn-ghost text-xs" onClick={() => onNavigate("llm")}>
                  {t("prompt.openPolishSettings")}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </Section>

      {/* Advanced: System Prompt */}
      <Section title={t("prompt.advanced")} description={t("prompt.systemPromptDesc")}>
        <div className="space-y-3">
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? t("prompt.hideAdvanced") : t("prompt.showAdvanced")}
          </button>

          {showAdvanced ? (
            <div className="space-y-3">
              <textarea
                id="system-prompt"
                name="system-prompt"
                value={prompt.system_prompt}
                onChange={(e) => update({ system_prompt: e.target.value })}
                className="field-textarea"
                rows={10}
              />
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary text-xs" onClick={resetSystemPrompt}>
                  {t("prompt.resetToDefault")}
                </button>
              </div>
              <Notice title={t("prompt.advancedWarningTitle")} tone="warning">
                {t("prompt.advancedWarningBody")}
              </Notice>
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
