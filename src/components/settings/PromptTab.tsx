import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAppStore } from "../../stores/appStore";
import { getDefaultSystemPrompt } from "../../lib/defaultSettings";
import { buildPromptPreview } from "../../lib/settingsFormatters";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import { Notice, Section } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";
import { HintTip } from "../ui/Tooltip";
import type { SettingsTab } from "./tabs";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

function getFallbackPlatform(): "macos" | "windows" | "linux" {
  if (typeof navigator !== "undefined") {
    if (/mac/i.test(navigator.platform)) return "macos";
    if (/linux/i.test(navigator.platform)) return "linux";
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
    <div className="space-y-10">
      {llmDisabled ? (
        <Notice title={t("prompt.llmDisabledTitle")} tone="warning">
          {t("prompt.llmDisabledBody")}
        </Notice>
      ) : null}

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
                <button type="button" className="btn btn-ghost text-xs" onClick={() => update({ user_instructions: "" })}>
                  {t("prompt.clearInstructions")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Section>

      {/* Context Sources */}
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

          {/* ── Basic context sources ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <p id="context-clipboard-label" className="text-[13px] font-medium">{t("prompt.contextClipboard")}</p>
                <p className={hintCls}>{t("prompt.contextClipboardHint")}</p>
              </div>
              <Toggle
                checked={prompt.context_clipboard}
                onChange={(v) => update({ context_clipboard: v })}
                ariaLabelledBy="context-clipboard-label"
                disabled={llmDisabled}
              />
            </div>
            <div className="flex items-center justify-between gap-4 py-1">
              <div>
                <p id="context-selection-label" className="text-[13px] font-medium">{t("prompt.contextSelection")}</p>
                <p className={hintCls}>{t("prompt.contextSelectionHint", { shortcut: platform === "macos" ? "Cmd+C" : "Ctrl+C" })}</p>
              </div>
              <Toggle
                checked={prompt.context_selection}
                onChange={(v) => update({ context_selection: v })}
                ariaLabelledBy="context-selection-label"
                disabled={llmDisabled}
              />
            </div>
          </div>

          {/* ── Divider + advanced toggle ── */}
          <div className="border-t border-[var(--border)] pt-2">
            <button
              type="button"
              className="btn btn-ghost text-xs w-full text-left flex items-center gap-1"
              aria-expanded={showAdvancedContext}
              aria-controls="prompt-advanced-context-panel"
              onClick={() => setShowAdvancedContext(!showAdvancedContext)}
            >
              <span className="text-[var(--text-muted)] text-[10px] transition-transform" style={{ transform: showAdvancedContext ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
              {showAdvancedContext ? t("prompt.hideAdvancedContext") : t("prompt.showAdvancedContext")}
            </button>
          </div>

          {/* ── Advanced context sources (collapsible) ── */}
          {showAdvancedContext ? (
            <div id="prompt-advanced-context-panel" className="space-y-2 pl-1">
              <div className="flex items-center justify-between gap-4 py-1">
                <div>
                  <p id="context-active-app-label" className="text-[13px] font-medium">{t("prompt.contextActiveApp")}</p>
                  <p className={hintCls}>{t("prompt.contextActiveAppHint")}</p>
                  {platform === "macos" ? (
                    <p className="mt-1 text-[11px] font-medium text-[var(--amber)]">{t("prompt.contextActiveAppMacNote")}</p>
                  ) : null}
                </div>
                <Toggle
                  checked={prompt.context_active_app}
                  onChange={(v) => update({ context_active_app: v })}
                  ariaLabelledBy="context-active-app-label"
                  disabled={llmDisabled}
                />
              </div>
              {platform !== "linux" && (
              <div className="flex items-center justify-between gap-4 py-1">
                <div>
                  <p id="context-input-field-label" className="text-[13px] font-medium">{t("prompt.contextInputField")}</p>
                  <p className={hintCls}>{t("prompt.contextInputFieldHint")}</p>
                  <p className="mt-1 text-[11px] font-medium text-[var(--amber)]">
                    {platform === "windows"
                      ? t("prompt.contextInputFieldNoteWindows")
                      : platform === "macos"
                        ? t("prompt.contextInputFieldNoteMacos")
                        : t("prompt.contextInputFieldNote")}
                  </p>
                </div>
                <Toggle
                  checked={prompt.context_input_field}
                  onChange={(v) => update({ context_input_field: v })}
                  ariaLabelledBy="context-input-field-label"
                  disabled={llmDisabled}
                />
              </div>
              )}
              <div className="flex items-center justify-between gap-4 py-1">
                <div>
                  <p id="context-screenshot-label" className="text-[13px] font-medium">{t("prompt.contextScreenshot")}</p>
                  <p className={hintCls}>{t("prompt.contextScreenshotHint")}</p>
                  <p className="mt-1 text-[11px] font-medium text-[var(--amber)]">{t("prompt.contextScreenshotNote")}</p>
                </div>
                <Toggle
                  checked={prompt.context_screenshot}
                  onChange={(v) => update({ context_screenshot: v })}
                  ariaLabelledBy="context-screenshot-label"
                  disabled={llmDisabled}
                />
              </div>
            </div>
          ) : null}
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
          <div className="rounded-lg bg-[var(--bg-subtle)] p-3">
            <pre className="pre-wrap max-h-72 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
              {previewText}
            </pre>
          </div>
          <div className="flex gap-2">
            {onNavigate ? (
              <>
                <button className="btn btn-secondary text-xs" onClick={() => onNavigate("vocabulary")}>
                  {t("prompt.openVocabulary")}
                </button>
                <button className="btn btn-secondary text-xs" onClick={() => onNavigate("llm")}>
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
            aria-expanded={showAdvanced}
            aria-controls="system-prompt-panel"
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
