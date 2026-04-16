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
import { useAppStore, type PermissionState } from "../../stores/appStore";
import { EmptyState, Notice, PageIntro, Section, StatusDot } from "./SettingPrimitives";
import type { SettingsTab } from "./tabs";

type DotTone = "default" | "success" | "warning" | "danger";

function permissionTone(state: PermissionState): DotTone {
  switch (state) {
    case "granted":
      return "success";
    case "denied":
      return "danger";
    case "not_determined":
      return "warning";
    case "not_applicable":
      return "default";
    default:
      return "warning";
  }
}

interface OverviewCardProps {
  children: ReactNode;
  className?: string;
}

function OverviewCard({ children, className = "" }: OverviewCardProps) {
  return (
    <div
      className={`section-card ${className}`}
    >
      {children}
    </div>
  );
}

interface OverviewTabProps {
  onNavigate: (tab: SettingsTab) => void;
}

type PermissionItem = {
  key: string;
  tone: DotTone;
  title: string;
  body: string;
  settingsUrl?: string;
  actionLabel?: string;
  requestCategory?: string;
};

export default function OverviewTab({ onNavigate }: OverviewTabProps) {
  const { t } = useTranslation();
  const [openSettingsFailed, setOpenSettingsFailed] = useState(false);
  const settings = useSettingsStore((s) => s.settings);
  const platform = useAppStore((s) => s.platform);
  const displayServer = useAppStore((s) => s.displayServer);
  const permissions = useAppStore((s) => s.permissions);
  const loadPermissions = useAppStore((s) => s.loadPermissions);
  const requestPermission = useAppStore((s) => s.requestPermission);
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
          ? t("overview.metricValues.ready")
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

  const permissionItems: PermissionItem[] = (() => {
    const mic = permissions?.microphone ?? "unknown";
    const acc = permissions?.accessibility ?? "unknown";
    const scr = permissions?.screen_recording ?? "unknown";

    if (platform === "macos") {
      return [
        {
          key: "microphone",
          tone: permissionTone(mic),
          title: t("overview.permissions.microphoneTitle"),
          body: mic === "granted"
            ? t("overview.permissions.statusGranted")
            : mic === "denied"
              ? t("overview.permissions.macosMicrophoneDenied")
              : t("overview.permissions.macosMicrophoneBody"),
          settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
          actionLabel: mic === "granted" ? undefined : t("overview.permissions.openMicrophoneSettings"),
          requestCategory: mic === "not_determined" ? "microphone" : undefined,
        },
        {
          key: "accessibility",
          tone: acc === "granted"
            ? "success" as const
            : settings.general.output_mode === "auto_paste" || settings.general.auto_pause_media
              ? permissionTone(acc)
              : "default" as const,
          title: t("overview.permissions.accessibilityTitle"),
          body: acc === "granted"
            ? t("overview.permissions.statusGranted")
            : t("overview.permissions.macosAccessibilityBody"),
          settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
          actionLabel: acc === "granted" ? undefined : t("overview.permissions.openAccessibilitySettings"),
          requestCategory: acc === "granted" ? undefined : "accessibility",
        },
        {
          key: "screen_recording",
          tone: scr === "granted"
            ? "success" as const
            : settings.prompt.context_screenshot
              ? permissionTone(scr)
              : "default" as const,
          title: t("overview.permissions.screenRecordingTitle"),
          body: scr === "granted"
            ? t("overview.permissions.statusGranted")
            : t("overview.permissions.macosScreenRecordingBody"),
          settingsUrl: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
          actionLabel: scr === "granted" ? undefined : t("overview.permissions.openScreenRecordingSettings"),
          requestCategory: scr === "granted" ? undefined : "screen_recording",
        },
      ];
    }
    if (platform === "windows") {
      return [
        {
          key: "microphone",
          tone: permissionTone(mic),
          title: t("overview.permissions.microphoneTitle"),
          body: mic === "granted"
            ? t("overview.permissions.statusGranted")
            : mic === "denied"
              ? t("overview.permissions.windowsMicrophoneDenied")
              : t("overview.permissions.windowsMicrophoneBody"),
          settingsUrl: "ms-settings:privacy-microphone",
          actionLabel: mic === "granted" ? undefined : t("overview.permissions.openMicrophoneSettings"),
        },
        {
          key: "auto-paste",
          tone: "warning",
          title: t("overview.permissions.autoPasteTitle"),
          body: t("overview.permissions.windowsAutoPasteBody"),
        },
      ];
    }
    if (platform === "linux") {
      const items: PermissionItem[] = [
        {
          key: "microphone",
          tone: permissionTone(mic),
          title: t("overview.permissions.microphoneTitle"),
          body: mic === "granted"
            ? t("overview.permissions.statusGranted")
            : t("overview.permissions.linuxMicrophoneBody"),
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
      if (permissions?.pactl_available === false) {
        items.push({
          key: "pactl",
          tone: settings.general.background_audio_mode !== "off" ? "danger" : "warning",
          title: t("overview.permissions.pactlTitle"),
          body: t("overview.permissions.pactlBody"),
        });
      }
      if (permissions?.playerctl_available === false) {
        items.push({
          key: "playerctl",
          tone: settings.general.auto_pause_media ? "danger" : "warning",
          title: t("overview.permissions.playerctlTitle"),
          body: t("overview.permissions.playerctlBody"),
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
    <div className="space-y-6">
      <PageIntro
        eyebrow={t("settings.groups.workspace")}
        title={t("overview.title")}
        description={t("overview.desc")}
      />

      {platform === "linux" ? (
        <Notice title={t("general.linuxExperimentalTitle")} tone={displayServer === "wayland" ? "warning" : "default"}>
          {t("general.linuxExperimentalBody")}
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {summaryItems.map((item) => (
          <OverviewCard key={item.key} className="h-full">
            <StatusDot tone={item.tone}>{item.label}</StatusDot>
            <p className="mt-3 text-sm font-semibold text-(--text)">{item.value}</p>
            <p className="mt-1 text-xs leading-6 text-(--text-secondary)">{item.detail}</p>
          </OverviewCard>
        ))}
      </div>

      <Section title={t("overview.setup.title")} description={t("overview.setup.desc")}>
        <div className="space-y-3">
          {setupItems.map((item, index) => (
            <OverviewCard key={item.key}>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--bg-elevated) ring-1 ring-(--border) text-[11px] font-bold text-(--text-muted) shadow-(--shadow-xs)">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex items-center gap-3">
                    <StatusDot tone={item.ready ? "success" : "warning"}>
                      {item.ready ? t("overview.metricValues.ready") : t("overview.metricValues.pending")}
                    </StatusDot>
                    <h3 className="text-[13.5px] font-semibold text-(--text)">{item.label}</h3>
                    <p className="hidden md:block text-xs leading-5 text-(--text-muted) truncate md:max-w-xs">{item.detail}</p>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary shrink-0"
                  title={item.detail}
                  onClick={item.action}
                >
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
                <p className="mt-2 text-xs leading-5 text-(--text-secondary)">{item.body}</p>

                {isTauriRuntime() &&
                  (("requestCategory" in item && item.requestCategory) ||
                    (item.settingsUrl && item.actionLabel)) ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {"requestCategory" in item && item.requestCategory ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        title={item.body}
                        onClick={() => void requestPermission(item.requestCategory as string)}
                      >
                        {t("overview.permissions.requestPermission")}
                      </button>
                    ) : null}

                    {item.settingsUrl && item.actionLabel ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        title={item.body}
                        onClick={() => {
                          if (item.settingsUrl) {
                            void openSystemUrl(item.settingsUrl);
                          }
                        }}
                      >
                        {item.actionLabel}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </OverviewCard>
            ))}

            {isTauriRuntime() ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  title={t("overview.permissions.desc")}
                  onClick={() => void loadPermissions()}
                >
                  {t("overview.permissions.refreshPermissions")}
                </button>
              </div>
            ) : null}
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
                  title={t("general.outputDesc")}
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
                  <p className="whitespace-pre-wrap text-[13px] leading-6 text-(--text-secondary)">
                    {lastText}
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    title={t("overview.recent.desc")}
                    onClick={() => onNavigate("history")}
                  >
                    {t("overview.actions.openHistory")}
                  </button>
                </div>
              </OverviewCard>
            ) : (
              <EmptyState
                title={t("overview.recent.emptyTitle")}
                description={t("overview.recent.emptyDesc")}
                action={
                  <button
                    type="button"
                    className="btn btn-secondary"
                    title={t("overview.recent.desc")}
                    onClick={() => onNavigate("history")}
                  >
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
