import { useTranslation } from "react-i18next";
import { buildPromptPreview, formatHotkeyCombo, isLlmConfigured, isSttConfigured } from "../../lib/settingsFormatters";
import { useRecordingStore } from "../../stores/recordingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAppStore } from "../../stores/appStore";
import { EmptyState, Notice, PageLead, SectionCard, StatCard, StatusPill } from "./SettingPrimitives";
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

  const permissionItems = (() => {
    if (platform === "macos") {
      return [
        {
          tone: "warning" as const,
          title: t("overview.permissions.microphoneTitle"),
          body: t("overview.permissions.macosMicrophoneBody"),
        },
        {
          tone: settings.general.output_mode === "auto_paste" ? ("warning" as const) : ("default" as const),
          title: t("overview.permissions.accessibilityTitle"),
          body: t("overview.permissions.macosAccessibilityBody"),
        },
        {
          tone: "default" as const,
          title: t("overview.permissions.hotkeyTitle"),
          body: t("overview.permissions.macosHotkeyBody"),
        },
      ];
    }

    if (platform === "windows") {
      return [
        {
          tone: "warning" as const,
          title: t("overview.permissions.microphoneTitle"),
          body: t("overview.permissions.windowsMicrophoneBody"),
        },
        {
          tone: settings.general.output_mode === "auto_paste" ? ("warning" as const) : ("default" as const),
          title: t("overview.permissions.autoPasteTitle"),
          body: t("overview.permissions.windowsAutoPasteBody"),
        },
        {
          tone: "default" as const,
          title: t("overview.permissions.installTitle"),
          body: t("overview.permissions.windowsInstallBody"),
        },
      ];
    }

    if (platform === "linux") {
      return [
        {
          tone: "warning" as const,
          title: t("overview.permissions.microphoneTitle"),
          body: t("overview.permissions.linuxMicrophoneBody"),
        },
        {
          tone: settings.general.output_mode === "auto_paste" ? ("warning" as const) : ("default" as const),
          title: t("overview.permissions.autoPasteTitle"),
          body: t("overview.permissions.linuxAutoPasteBody"),
        },
      ];
    }

    return [
      {
        tone: "warning" as const,
        title: t("overview.permissions.unknownTitle"),
        body: t("overview.permissions.unknownBody"),
      },
    ];
  })();

  const setupRows = [
    {
      key: "speech",
      ready: sttReady,
      title: t("overview.setup.speechTitle"),
      description: sttReady
        ? t("overview.setup.speechReady", { model: settings.stt.model })
        : t("overview.setup.speechPending"),
      action: () => onNavigate("stt" as SettingsTab),
      actionLabel: t("overview.actions.configureSpeech"),
    },
    {
      key: "output",
      ready: true,
      title: t("overview.setup.outputTitle"),
      description:
        settings.general.output_mode === "auto_paste"
          ? t("overview.setup.outputAutoPaste")
          : t("overview.setup.outputClipboard"),
      action: () => onNavigate("general" as SettingsTab),
      actionLabel: t("overview.actions.adjustOutput"),
    },
    {
      key: "prompt",
      ready: hasCustomPrompt || !settings.llm.enabled,
      title: t("overview.setup.promptTitle"),
      description: settings.llm.enabled
        ? hasCustomPrompt
          ? t("overview.setup.promptReady", {
              count: settings.prompt.vocabulary.length,
            })
          : t("overview.setup.promptPending")
        : t("overview.setup.promptOptional"),
      action: () => onNavigate("prompt" as SettingsTab),
      actionLabel: t("overview.actions.reviewPrompt"),
    },
    {
      key: "permissions",
      ready: false,
      title: t("overview.setup.permissionsTitle"),
      description: t(`overview.platformSummary.${platform}`),
      action: () => onNavigate("general" as SettingsTab),
      actionLabel: t("overview.actions.reviewPermissions"),
    },
  ];

  const flowSteps = [
    t("overview.flow.capture"),
    t("overview.flow.transcribe"),
    settings.llm.enabled ? t("overview.flow.polish") : t("overview.flow.skipPolish"),
    settings.general.output_mode === "auto_paste"
      ? t("overview.flow.paste")
      : t("overview.flow.clipboard"),
  ];

  const promptPreview = buildPromptPreview(settings.prompt);
  const promptSnippet =
    promptPreview.length > 720 ? `${promptPreview.slice(0, 720)}\n…` : promptPreview;

  return (
    <div className="space-y-6">
      <PageLead
        eyebrow={t("overview.eyebrow")}
        title={t("overview.title")}
        description={t("overview.desc")}
        meta={
          <>
            <StatusPill tone={sttReady ? "success" : "warning"}>
              {sttReady ? t("overview.badges.ready") : t("overview.badges.setupNeeded")}
            </StatusPill>
            <StatusPill tone={recordingStatus === "error" ? "danger" : "accent"}>
              {t(`status.${recordingStatus}`)}
            </StatusPill>
            <StatusPill tone="default">{t(`overview.platformLabel.${platform}`)}</StatusPill>
          </>
        }
        actions={
          <>
            <button className="app-button-primary" onClick={() => onNavigate("stt")}>
              {t("overview.actions.configureSpeech")}
            </button>
            <button className="app-button-secondary" onClick={() => onNavigate("prompt")}>
              {t("overview.actions.reviewPrompt")}
            </button>
          </>
        }
      />

      <div className="app-metric-grid">
        <StatCard
          label={t("overview.stats.speech")}
          value={sttReady ? t("overview.metricValues.ready") : t("overview.metricValues.pending")}
          hint={settings.stt.model || t("overview.metricHints.addSpeechProvider")}
          tone={sttReady ? "success" : "warning"}
        />
        <StatCard
          label={t("overview.stats.polish")}
          value={
            settings.llm.enabled
              ? llmReady
                ? t("overview.metricValues.active")
                : t("overview.metricValues.pending")
              : t("overview.metricValues.off")
          }
          hint={settings.llm.enabled ? settings.llm.model : t("overview.metricHints.optional")}
          tone={settings.llm.enabled ? (llmReady ? "accent" : "warning") : "default"}
        />
        <StatCard
          label={t("overview.stats.hotkey")}
          value={formatHotkeyCombo(settings.general.hotkey)}
          hint={t(`general.${settings.general.hotkey.hotkey_type === "double_tap" ? "doubleTap" : settings.general.hotkey.hotkey_type === "combo" ? "combo" : settings.general.hotkey.hotkey_type === "hold" ? "hold" : "single"}`)}
          tone="default"
        />
        <StatCard
          label={t("overview.stats.vocabulary")}
          value={String(settings.prompt.vocabulary.length)}
          hint={
            hasCustomPrompt
              ? t("overview.metricHints.customRulesEnabled")
              : t("overview.metricHints.noRulesYet")
          }
          tone={hasCustomPrompt ? "accent" : "default"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
        <div className="space-y-6 min-w-0">
          <SectionCard
            title={t("overview.setup.title")}
            description={t("overview.setup.desc")}
            aside={<StatusPill tone={sttReady ? "success" : "warning"}>{sttReady ? t("overview.badges.coreReady") : t("overview.badges.finishSetup")}</StatusPill>}
          >
            <div className="space-y-3">
              {setupRows.map((item) => (
                <div key={item.key} className="app-subtle-surface flex flex-col gap-3 rounded-2xl border border-black/5 p-4 dark:border-white/8 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold tracking-tight">{item.title}</p>
                      <StatusPill tone={item.ready ? "success" : "warning"}>
                        {item.ready ? t("overview.badges.done") : t("overview.badges.needsReview")}
                      </StatusPill>
                    </div>
                    <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{item.description}</p>
                  </div>
                  <button className="app-button-ghost shrink-0" onClick={item.action}>
                    {item.actionLabel}
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={t("overview.flow.title")} description={t("overview.flow.desc")}>
            <ol className="grid gap-3 md:grid-cols-4">
              {flowSteps.map((step, index) => (
                <li key={step} className="app-subtle-surface rounded-2xl border border-black/5 p-4 dark:border-white/8">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                    {t("overview.flow.stepNumber", { count: index + 1 })}
                  </p>
                  <p className="mt-3 text-sm font-semibold tracking-tight">{step}</p>
                </li>
              ))}
            </ol>
          </SectionCard>

          <SectionCard
            title={t("overview.recent.title")}
            description={t("overview.recent.desc")}
            aside={<StatusPill tone={recordingStatus === "error" ? "danger" : "accent"}>{t(`status.${recordingStatus}`)}</StatusPill>}
          >
            {lastError ? (
              <Notice title={t("overview.recent.errorTitle")} tone="danger">
                {lastError}
              </Notice>
            ) : null}

            {lastText ? (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  {t("overview.recent.latestOutput")}
                </p>
                <div className="app-subtle-surface rounded-2xl border border-black/5 p-4 text-sm leading-7 text-gray-700 dark:border-white/8 dark:text-gray-200">
                  {lastText}
                </div>
              </div>
            ) : (
              <EmptyState
                icon="◌"
                title={t("overview.recent.emptyTitle")}
                description={t("overview.recent.emptyDesc")}
                action={
                  <button className="app-button-ghost" onClick={() => onNavigate("history")}>
                    {t("overview.actions.openHistory")}
                  </button>
                }
              />
            )}
          </SectionCard>
        </div>

        <div className="space-y-6 min-w-0">
          <SectionCard title={t("overview.permissions.title")} description={t("overview.permissions.desc")}>
            <div className="space-y-3">
              {permissionItems.map((item) => (
                <Notice key={item.title} title={item.title} tone={item.tone}>
                  {item.body}
                </Notice>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title={t("overview.prompt.title")}
            description={t("overview.prompt.desc")}
            aside={
              <StatusPill tone={hasCustomPrompt ? "accent" : "default"}>
                {hasCustomPrompt ? t("overview.prompt.customized") : t("overview.prompt.default")}
              </StatusPill>
            }
          >
            <div className="space-y-4">
              <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                {settings.llm.enabled
                  ? t("overview.prompt.enabledHint")
                  : t("overview.prompt.disabledHint")}
              </p>
              <div className="app-subtle-surface rounded-2xl border border-black/5 p-4 dark:border-white/8">
                <pre className="app-pre-wrap max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6 text-gray-700 dark:text-gray-200">
                  {promptSnippet}
                </pre>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="app-button-secondary" onClick={() => onNavigate("prompt")}>
                  {t("overview.actions.reviewPrompt")}
                </button>
                <button className="app-button-ghost" onClick={() => onNavigate("vocabulary")}>
                  {t("overview.actions.openVocabulary")}
                </button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
