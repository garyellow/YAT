import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  formatHotkeyCombo,
  isLlmConfigured,
  isSttConfigured,
} from "../../lib/settingsFormatters";
import { isTauriRuntime } from "../../lib/tauriRuntime";
import { useRecordingStore } from "../../stores/recordingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAppStore } from "../../stores/appStore";
import { EmptyState, Notice, Section, StatusDot } from "./SettingPrimitives";
import type { SettingsTab } from "./tabs";

type DotTone = "default" | "success" | "warning" | "danger";

interface OverviewCardProps {
  children: ReactNode;
  className?: string;
}

function OverviewCard({ children, className = "" }: OverviewCardProps) {
  return (
    <div
      className={`rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

interface OverviewTabProps {
  onNavigate: (tab: SettingsTab) => void;
}

export default function OverviewTab({ onNavigate }: OverviewTabProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const platform = useAppStore((s) => s.platform);
  const displayServer = useAppStore((s) => s.displayServer);
  const recordingStatus = useRecordingStore((s) => s.status);
  const lastText = useRecordingStore((s) => s.lastText);
  const lastError = useRecordingStore((s) => s.lastError);
  const pasteFailCount = useRecordingStore((s) => s.pasteFailCount);

  if (!settings) return null;

  const sttReady = isSttConfigured(settings);
  const llmReady = isLlmConfigured(settings);
  const hasCustomPrompt =
    settings.prompt.user_instructions.trim().length > 0 ||
    settings.prompt.vocabulary.length > 0;

  const [openSettingsFailed, setOpenSettingsFailed] = useState(false);

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

  const summaryItems: Array<{
    key: string;
    label: string;
    value: string;
    detail: string;
    tone: DotTone;
  }> = [
    {
      key: "speech",
      label: t("overview.stats.speech"),
      value: sttReady ? t("overview.metricValues.ready") : t("overview.metricValues.pending"),
      detail: sttReady
        ? t("overview.summary.speechReady", { model: settings.stt.model })
        : t("overview.summary.speechPending"),
      tone: sttReady ? "success" : "warning",
    },
    {
      key: "polish",
      label: t("overview.stats.polish"),
      value: !settings.llm.enabled
        ? t("overview.metricValues.off")
        : llmReady
          ? t("overview.metricValues.active")
          : t("overview.metricValues.pending"),
      detail: !settings.llm.enabled
        ? t("overview.summary.polishOff")
        : llmReady
          ? t("overview.summary.polishOn", { model: settings.llm.model })
          : t("overview.summary.polishPending"),
      tone: !settings.llm.enabled ? "default" : llmReady ? "success" : "warning",
    },
    {
      key: "output",
      label: t("general.sectionOutput"),
      value:
        settings.general.output_mode === "auto_paste"
          ? t("general.autoPaste")
          : t("general.clipboardOnly"),
      detail:
        settings.general.output_mode === "auto_paste"
          ? t("overview.summary.outputAutoPaste")
          : t("overview.summary.outputClipboard"),
      tone: "default",
    },
    {
      key: "hotkey",
      label: t("overview.stats.hotkey"),
      value: formatHotkeyCombo(settings.general.hotkey),
      detail: t("overview.summary.hotkeyStatus", {
        status: t(`status.${recordingStatus}`),
      }),
      tone: recordingStatus === "error" ? "danger" : "default",
    },
  ];

  const permissionItems = (() => {
    if (platform === "macos") {
      return [
        {
          key: "microphone",
          tone: "warning" as const,
          title: t("overview.permissions.microphoneTitle"),
          body: t("overview.permissions.macosMicrophoneBody"),
          settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
          actionLabel: t("overview.permissions.openMicrophoneSettings"),
        },
        {
          key: "accessibility",
          tone:
            settings.general.output_mode === "auto_paste"
              ? ("warning" as const)
              : ("default" as const),
          title: t("overview.permissions.accessibilityTitle"),
          body: t("overview.permissions.macosAccessibilityBody"),
          settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          actionLabel: t("overview.permissions.openAccessibilitySettings"),
        },
      ];
    }
    if (platform === "windows") {
      return [
        {
          key: "microphone",
          tone: "warning" as const,
          title: t("overview.permissions.microphoneTitle"),
          body: t("overview.permissions.windowsMicrophoneBody"),
          settingsUrl: "ms-settings:privacy-microphone",
          actionLabel: t("overview.permissions.openMicrophoneSettings"),
        },
        {
          key: "auto-paste",
          tone:
            settings.general.output_mode === "auto_paste"
              ? ("warning" as const)
              : ("default" as const),
          title: t("overview.permissions.autoPasteTitle"),
          body: t("overview.permissions.windowsAutoPasteBody"),
        },
      ];
    }
    if (platform === "linux") {
      const items: Array<{
        key: string;
        tone: "warning" | "danger" | "default";
        title: string;
        body: string;
        settingsUrl?: string;
        actionLabel?: string;
      }> = [
        {
          key: "microphone",
          tone: "warning",
          title: t("overview.permissions.microphoneTitle"),
          body: t("overview.permissions.linuxMicrophoneBody"),
        },
        {
          key: "hotkey",
          tone: "warning",
          title: t("overview.permissions.hotkeyTitle"),
          body: t("overview.permissions.linuxHotkeyBody"),
        },
      ];
      if (displayServer === "wayland") {
        items.push({
          key: "wayland",
          tone: "danger",
          title: t("overview.permissions.waylandTitle"),
          body: t("overview.permissions.waylandBody"),
        });
      }
      return items;
    }
    return [
      {
        key: "unknown",
        tone: "warning" as const,
        title: t("overview.permissions.unknownTitle"),
        body: t("overview.permissions.unknownBody"),
      },
    ];
  })();

  const openSystemUrl = async (url: string) => {
    if (!isTauriRuntime()) return;

    setOpenSettingsFailed(false);

    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (error) {
      console.error("Failed to open system settings:", error);
      setOpenSettingsFailed(true);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[24px] border border-[var(--border)] bg-[var(--bg-subtle)]/70 p-5 shadow-sm sm:p-6">
        <div className="max-w-2xl">
          <h1 className="text-lg font-semibold leading-7 text-balance">{t("overview.title")}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{t("overview.desc")}</p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {summaryItems.map((item) => (
            <OverviewCard key={item.key} className="h-full">
              <StatusDot tone={item.tone}>{item.label}</StatusDot>
              <p className="mt-3 text-sm font-semibold text-[var(--text)]">{item.value}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{item.detail}</p>
            </OverviewCard>
          ))}
        </div>
      </section>

      <Section title={t("overview.setup.title")} description={t("overview.setup.desc")}>
        <div className="space-y-3">
          {setupItems.map((item, index) => (
            <OverviewCard key={item.key}>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[11px] font-semibold text-[var(--text-muted)]">
                    {index + 1}
                  </span>

                  <div className="min-w-0">
                    <StatusDot tone={item.ready ? "success" : "warning"}>
                      {item.ready ? t("overview.metricValues.ready") : t("overview.metricValues.pending")}
                    </StatusDot>
                    <h3 className="mt-2 text-sm font-semibold text-[var(--text)]">{item.label}</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{item.detail}</p>
                  </div>
                </div>

                <button type="button" className="btn btn-secondary shrink-0" onClick={item.action}>
                  {item.actionLabel}
                </button>
              </div>
            </OverviewCard>
          ))}
        </div>
      </Section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Section title={t("overview.permissions.title")} description={t("overview.permissions.desc")}>
          <div className="space-y-3">
            {openSettingsFailed ? (
              <Notice title={t("overview.permissions.unknownTitle")} tone="warning">
                {t("overview.permissions.openSettingsFailed")}
              </Notice>
            ) : null}

            {permissionItems.map((item) => (
              <OverviewCard key={item.key}>
                <StatusDot tone={item.tone}>{item.title}</StatusDot>
                <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{item.body}</p>

                {item.settingsUrl && item.actionLabel && isTauriRuntime() ? (
                  <button
                    type="button"
                    className="btn btn-secondary mt-4"
                    onClick={() => {
                      if (item.settingsUrl) {
                        void openSystemUrl(item.settingsUrl);
                      }
                    }}
                  >
                    {item.actionLabel}
                  </button>
                ) : null}
              </OverviewCard>
            ))}
          </div>
        </Section>

        <Section title={t("overview.recent.title")} description={t("overview.recent.desc")}>
          <div className="space-y-3">
            {pasteFailCount >= 3 && settings.general.output_mode === "auto_paste" ? (
              <Notice title={t("overview.pasteFailSuggest.title")} tone="warning">
                {t("overview.pasteFailSuggest.body")}
                <button
                  type="button"
                  className="btn btn-secondary mt-3"
                  onClick={() => onNavigate("general")}
                >
                  {t("overview.actions.adjustOutput")}
                </button>
              </Notice>
            ) : null}

            {lastError ? (
              <Notice title={t("overview.recent.errorTitle")} tone="danger">
                {lastError}
              </Notice>
            ) : null}

            {lastText ? (
              <OverviewCard>
                <div className="max-h-48 overflow-auto">
                  <p className="whitespace-pre-wrap text-[13px] leading-6 text-[var(--text-secondary)]">
                    {lastText}
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <button type="button" className="btn btn-secondary" onClick={() => onNavigate("history")}>
                    {t("overview.actions.openHistory")}
                  </button>
                </div>
              </OverviewCard>
            ) : (
              <EmptyState
                title={t("overview.recent.emptyTitle")}
                description={t("overview.recent.emptyDesc")}
                action={
                  <button type="button" className="btn btn-secondary" onClick={() => onNavigate("history")}>
                    {t("overview.actions.openHistory")}
                  </button>
                }
              />
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
