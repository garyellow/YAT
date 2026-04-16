import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAppStore } from "../../stores/appStore";
import { getDefaultSystemPrompt } from "../../lib/defaultSettings";
import { buildPromptPreview } from "../../lib/settingsFormatters";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import { Notice, PageIntro, Section, SettingList, SettingRow } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";
import { HintTip } from "../ui/Tooltip";
import type { SettingsTab } from "./tabs";

const labelCls = "text-xs font-medium text-(--text-secondary)";
const hintCls = "text-[11px] text-(--text-muted)";

function getFallbackPlatform(): "macos" | "windows" | "linux" {
  if (typeof navigator !== "undefined") {
    const platform = (navigator as any).userAgentData?.platform ?? navigator.platform;
    if (/mac/i.test(platform)) return "macos";
    if (/linux/i.test(platform)) return "linux";
  }
  return "windows";
}

interface PromptTabProps {
  onNavigate?: (tab: SettingsTab) => void;
}

export default function PromptTab({ onNavigate }: PromptTabProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const appPlatform = useAppStore((s) => s.platform);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAdvancedContext, setShowAdvancedContext] = useState(false);
  const platform = appPlatform === "unknown" ? getFallbackPlatform() : appPlatform;

  if (!settings) return null;
  const prompt = settings.prompt;

  const update = (patch: Partial<typeof prompt>) => {
    updateSettings({ prompt: { ...prompt, ...patch } });
  };

  const previewText = buildPromptPreview(prompt);
  const llmDisabled = !settings.llm.enabled;
  const enabledContextCount = [
    prompt.context_clipboard,
    prompt.context_selection,
    prompt.context_active_app,
    prompt.context_input_field,
    prompt.context_screenshot,
  ].filter(Boolean).length;

  const advancedContextCount = [
    prompt.context_active_app,
    prompt.context_input_field,
    prompt.context_screenshot,
  ].filter(Boolean).length;

  const insertPreset = (preset: string) => {
    const current = prompt.user_instructions;
    const sep = current.trim().length > 0 ? "\n" : "";
    update({ user_instructions: current + sep + preset });
  };

  const resetSystemPrompt = async () => {
    if (!isTauriRuntime()) {
      update({ system_prompt: getDefaultSystemPrompt() });
      return;
    }

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
    <div className="space-y-6">
      <PageIntro
        eyebrow={t("settings.groups.customize")}
        title={t("tabs.prompt")}
        description={t("prompt.pageDesc")}
      />

      {llmDisabled ? (
        <Notice title={t("prompt.llmDisabledTitle")} tone="warning">
          <div className="space-y-3">
            <p>{t("prompt.llmDisabledBody")}</p>
            {onNavigate ? (
              <div>
                <button
                  type="button"
                  className="btn btn-primary text-xs"
                  onClick={() => onNavigate("llm")}
                >
                  {t("prompt.goEnableLlm")}
                </button>
              </div>
            ) : null}
          </div>
        </Notice>
      ) : null}

      <Section title={t("prompt.userInstructions")} description={t("prompt.userInstructionsDesc")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="btn btn-secondary text-xs"
                title={preset.value}
                onClick={() => insertPreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="user-instructions" className={labelCls}>{t("prompt.userInstructions")}</label>
            <p className={hintCls}>{t("prompt.userInstructionsHint")}</p>
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
              {prompt.user_instructions.trim().length > 0 ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-compact text-xs"
                  title={t("prompt.userInstructionsHint")}
                  onClick={() => update({ user_instructions: "" })}
                >
                  {t("prompt.clearInstructions")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title={(
          <span className="inline-flex items-center gap-1.5">
            <span>{t("prompt.contextSourcesTitle")}</span>
            <HintTip text={t("prompt.contextSourcesTooltip")} />
          </span>
        )}
        description={t("prompt.contextSourcesDesc")}
      >
        <div className="space-y-3">
          {enabledContextCount > 0 ? (
            <Notice title={t("prompt.contextEnabledTitle")} tone="warning">
              {t("prompt.contextEnabledBody", { count: enabledContextCount })}
            </Notice>
          ) : null}

          <SettingList>
            <SettingRow
              labelId="context-clipboard-label"
              label={t("prompt.contextClipboard")}
              description={t("prompt.contextClipboardHint")}
              control={
                <Toggle
                  checked={prompt.context_clipboard}
                  onChange={(v) => update({ context_clipboard: v })}
                  ariaLabelledBy="context-clipboard-label"
                  disabled={llmDisabled}
                />
              }
            />

            <SettingRow
              labelId="context-selection-label"
              label={t("prompt.contextSelection")}
              description={t("prompt.contextSelectionHintShort")}
              hint={platform !== "macos" ? t("prompt.contextSelectionHint") : undefined}
              control={
                <Toggle
                  checked={prompt.context_selection}
                  onChange={(v) => update({ context_selection: v })}
                  ariaLabelledBy="context-selection-label"
                  disabled={llmDisabled}
                />
              }
            />

            <SettingRow
              label={showAdvancedContext ? t("prompt.hideAdvancedContext") : t("prompt.showAdvancedContext")}
              description={t("prompt.showAdvancedContextHint")}
              control={
                <button
                  type="button"
                  className="btn btn-secondary btn-compact disclosure-btn"
                  aria-expanded={showAdvancedContext}
                  aria-controls="prompt-advanced-context-panel"
                  title={t("prompt.contextSourcesTooltip")}
                  onClick={() => setShowAdvancedContext(!showAdvancedContext)}
                >
                  <span className="disclosure-btn-value">{advancedContextCount}</span>
                  <span
                    className="disclosure-btn-chevron"
                    style={{ transform: showAdvancedContext ? "rotate(90deg)" : "rotate(0deg)" }}
                    aria-hidden="true"
                  >
                    ▶
                  </span>
                </button>
              }
            >
              {showAdvancedContext ? (
                <div id="prompt-advanced-context-panel">
                  <SettingList>
                    <SettingRow
                      inset
                      labelId="context-active-app-label"
                      label={t("prompt.contextActiveApp")}
                      description={t("prompt.contextActiveAppHint")}
                      hint={platform === "macos" ? t("prompt.contextActiveAppMacNote") : undefined}
                      control={
                        <Toggle
                          checked={prompt.context_active_app}
                          onChange={(v) => update({ context_active_app: v })}
                          ariaLabelledBy="context-active-app-label"
                          disabled={llmDisabled}
                        />
                      }
                    />

                    {platform !== "linux" ? (
                      <SettingRow
                        inset
                        labelId="context-input-field-label"
                        label={t("prompt.contextInputField")}
                        description={t("prompt.contextInputFieldHint")}
                        hint={platform === "windows"
                          ? t("prompt.contextInputFieldNoteWindows")
                          : platform === "macos"
                            ? t("prompt.contextInputFieldNoteMacos")
                            : t("prompt.contextInputFieldNote")}
                        control={
                          <Toggle
                            checked={prompt.context_input_field}
                            onChange={(v) => update({ context_input_field: v })}
                            ariaLabelledBy="context-input-field-label"
                            disabled={llmDisabled}
                          />
                        }
                      />
                    ) : null}

                    <SettingRow
                      inset
                      labelId="context-screenshot-label"
                      label={t("prompt.contextScreenshot")}
                      description={t("prompt.contextScreenshotHint")}
                      hint={t("prompt.contextScreenshotNote")}
                      control={
                        <Toggle
                          checked={prompt.context_screenshot}
                          onChange={(v) => update({ context_screenshot: v })}
                          ariaLabelledBy="context-screenshot-label"
                          disabled={llmDisabled}
                        />
                      }
                    />
                  </SettingList>
                </div>
              ) : null}
            </SettingRow>
          </SettingList>
        </div>
      </Section>

      <Section
        title={t("prompt.previewTitle")}
        description={t("prompt.previewDesc")}
        aside={
          <span className="text-xs text-(--text-muted)">
            {t("prompt.charCount", { count: previewText.length })}
          </span>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-(--bg-subtle) p-3">
            <pre className="pre-wrap max-h-72 overflow-auto whitespace-pre-wrap text-xs text-(--text-secondary)">
              {previewText}
            </pre>
          </div>
          <div className="flex gap-2">
            {onNavigate ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  title={t("vocabulary.pageDesc")}
                  onClick={() => onNavigate("vocabulary")}
                >
                  {t("prompt.openVocabulary")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  title={t("llm.modeDesc")}
                  onClick={() => onNavigate("llm")}
                >
                  {t("prompt.openPolishSettings")}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </Section>

      <Section title={t("prompt.advanced")} description={t("prompt.systemPromptDesc")}>
        <div className="space-y-3">
          <button
            type="button"
            className="btn btn-secondary btn-compact text-xs"
            aria-expanded={showAdvanced}
            aria-controls="system-prompt-panel"
            title={t("prompt.systemPromptDesc")}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? t("prompt.hideAdvanced") : t("prompt.showAdvanced")}
          </button>

          {showAdvanced ? (
            <div id="system-prompt-panel" className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="system-prompt" className={labelCls}>{t("prompt.advanced")}</label>
                <textarea
                  id="system-prompt"
                  name="system-prompt"
                  value={prompt.system_prompt}
                  onChange={(e) => update({ system_prompt: e.target.value })}
                  className="field-textarea"
                  rows={10}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  title={t("prompt.systemPromptDesc")}
                  onClick={resetSystemPrompt}
                >
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
