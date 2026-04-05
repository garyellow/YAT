import { useTranslation } from "react-i18next";
import {
  buildPromptPreview,
  formatHotkeyCombo,
  isLlmConfigured,
  isSttConfigured,
} from "../../lib/settingsFormatters";
import { useRecordingStore } from "../../stores/recordingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAppStore } from "../../stores/appStore";
import { EmptyState, Notice, Section, StatusDot } from "./SettingPrimitives";
import type { SettingsTab } from "./tabs";

interface OverviewTabProps {
  onNavigate: (tab: SettingsTab) => void;
}

export default function OverviewTab({ onNavigate }: OverviewTabProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const platform = useAppStore((s) => s.platform);
  const recordingStatus = useRecordingStore((s) => s.status);
  const lastText = useRecordingStore((s) => s.lastText);
  const lastError = useRecordingStore((s) => s.lastError);

  if (!settings) return null;

  const sttReady = isSttConfigured(settings);
  const llmReady = isLlmConfigured(settings);
  const hasCustomPrompt =
    settings.prompt.user_instructions.trim().length > 0 ||
    settings.prompt.vocabulary.length > 0;

  const promptPreview = buildPromptPreview(settings.prompt);
  const promptSnippet =
    promptPreview.length > 500 ? `${promptPreview.slice(0, 500)}\n…` : promptPreview;

  const setupItems = [
    {
      key: "speech",
      ready: sttReady,
      label: t("overview.setup.speechTitle"),
      detail: sttReady
        ? t("overview.setup.speechReady", { model: settings.stt.model })
        : t("overview.setup.speechPending"),
      action: () => onNavigate("stt"),
      actionLabel: t("overview.actions.configureSpeech"),
    },
    {
      key: "output",
      ready: true,
      label: t("overview.setup.outputTitle"),
      detail:
        settings.general.output_mode === "auto_paste"
          ? t("overview.setup.outputAutoPaste")
          : t("overview.setup.outputClipboard"),
      action: () => onNavigate("general"),
      actionLabel: t("overview.actions.adjustOutput"),
    },
    {
      key: "prompt",
      ready: hasCustomPrompt || !settings.llm.enabled,
      label: t("overview.setup.promptTitle"),
      detail: settings.llm.enabled
        ? hasCustomPrompt
          ? t("overview.setup.promptReady", { count: settings.prompt.vocabulary.length })
          : t("overview.setup.promptPending")
        : t("overview.setup.promptOptional"),
      action: () => onNavigate("prompt"),
      actionLabel: t("overview.actions.reviewPrompt"),
    },
  ];

  const permissionItems = (() => {
    if (platform === "macos") {
      return [
        { tone: "warning" as const, title: t("overview.permissions.microphoneTitle"), body: t("overview.permissions.macosMicrophoneBody") },
        { tone: settings.general.output_mode === "auto_paste" ? "warning" as const : "default" as const, title: t("overview.permissions.accessibilityTitle"), body: t("overview.permissions.macosAccessibilityBody") },
      ];
    }
    if (platform === "windows") {
      return [
        { tone: "warning" as const, title: t("overview.permissions.microphoneTitle"), body: t("overview.permissions.windowsMicrophoneBody") },
        { tone: settings.general.output_mode === "auto_paste" ? "warning" as const : "default" as const, title: t("overview.permissions.autoPasteTitle"), body: t("overview.permissions.windowsAutoPasteBody") },
      ];
    }
    if (platform === "linux") {
      return [
        { tone: "warning" as const, title: t("overview.permissions.microphoneTitle"), body: t("overview.permissions.linuxMicrophoneBody") },
        { tone: "warning" as const, title: t("overview.permissions.hotkeyTitle"), body: t("overview.permissions.linuxHotkeyBody") },
      ];
    }
    return [
      { tone: "warning" as const, title: t("overview.permissions.unknownTitle"), body: t("overview.permissions.unknownBody") },
    ];
  })();

  return (
    <div className="space-y-10">
      {/* Status summary */}
      <div>
        <h1 className="text-base font-medium">{t("overview.title")}</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("overview.desc")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <StatusDot tone={sttReady ? "success" : "warning"}>
            {t("overview.stats.speech")}: {sttReady ? t("overview.metricValues.ready") : t("overview.metricValues.pending")}
          </StatusDot>
          <StatusDot tone={llmReady ? "success" : "warning"}>
            {t("overview.stats.polish")}: {settings.llm.enabled ? (llmReady ? t("overview.metricValues.active") : t("overview.metricValues.pending")) : t("overview.metricValues.off")}
          </StatusDot>
          <StatusDot tone="default">
            {t("overview.stats.hotkey")}: {formatHotkeyCombo(settings.general.hotkey)}
          </StatusDot>
          <StatusDot tone={recordingStatus === "error" ? "danger" : "default"}>
            {t(`status.${recordingStatus}`)}
          </StatusDot>
        </div>
      </div>

      {/* Setup checklist */}
      <Section title={t("overview.setup.title")} description={t("overview.setup.desc")}>
        <div className="space-y-3">
          {setupItems.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-4 py-2 border-b border-[var(--border)] last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusDot tone={item.ready ? "success" : "warning"}>
                    <span className="text-[13px] font-medium text-[var(--text)]">{item.label}</span>
                  </StatusDot>
                </div>
                <p className="mt-0.5 pl-[18px] text-xs text-[var(--text-muted)]">{item.detail}</p>
              </div>
              <button className="btn btn-ghost shrink-0 text-xs" onClick={item.action}>
                {item.actionLabel}
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Permissions */}
      <Section title={t("overview.permissions.title")} description={t("overview.permissions.desc")}>
        <div className="space-y-2">
          {permissionItems.map((item) => (
            <Notice key={item.title} title={item.title} tone={item.tone}>
              {item.body}
            </Notice>
          ))}
        </div>
      </Section>

      {/* Recent output */}
      <Section
        title={t("overview.recent.title")}
        description={t("overview.recent.desc")}
      >
        {lastError ? (
          <Notice title={t("overview.recent.errorTitle")} tone="danger">
            {lastError}
          </Notice>
        ) : null}

        {lastText ? (
          <div className="rounded bg-[var(--bg-subtle)] p-3 text-[13px] text-[var(--text-secondary)]">
            {lastText}
          </div>
        ) : (
          <EmptyState
            title={t("overview.recent.emptyTitle")}
            description={t("overview.recent.emptyDesc")}
            action={
              <button className="btn btn-ghost text-xs" onClick={() => onNavigate("history")}>
                {t("overview.actions.openHistory")}
              </button>
            }
          />
        )}
      </Section>

      {/* Prompt preview */}
      <Section title={t("overview.prompt.title")} description={t("overview.prompt.desc")}>
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            {settings.llm.enabled
              ? t("overview.prompt.enabledHint")
              : t("overview.prompt.disabledHint")}
          </p>
          <div className="rounded bg-[var(--bg-subtle)] p-3">
            <pre className="pre-wrap max-h-60 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
              {promptSnippet}
            </pre>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary text-xs" onClick={() => onNavigate("prompt")}>
              {t("overview.actions.reviewPrompt")}
            </button>
            <button className="btn btn-ghost text-xs" onClick={() => onNavigate("vocabulary")}>
              {t("overview.actions.openVocabulary")}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
