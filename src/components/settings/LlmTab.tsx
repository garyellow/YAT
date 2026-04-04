import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { Notice, OptionCard, SectionCard, StatusPill } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";

const fieldLabelCls = "text-sm font-medium text-gray-700 dark:text-gray-200";
const fieldHintCls = "text-xs leading-5 text-gray-500 dark:text-gray-400";

export default function LlmTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [showKey, setShowKey] = useState(false);

  if (!settings) return null;
  const llm = settings.llm;

  const update = (patch: Partial<typeof llm>) => {
    updateSettings({ llm: { ...llm, ...patch } });
  };

  const applyPreset = (preset: "groq" | "openai") => {
    if (preset === "groq") {
      update({
        base_url: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
      });
      return;
    }

    update({
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const msg = await invoke<string>("test_llm", { config: llm });
      setTestStatus("ok");
      setTestMsg(msg);
    } catch (e) {
      setTestStatus("fail");
      setTestMsg(String(e));
    }
  };

  return (
    <div className="space-y-6">
      <Notice title={t("llm.quickStartTitle")} tone="accent">
        {t("llm.quickStartDesc")}
      </Notice>

      <SectionCard
        title={t("llm.modeTitle")}
        description={t("llm.modeDesc")}
        aside={<StatusPill tone={llm.enabled ? "accent" : "default"}>{llm.enabled ? t("llm.enabledStateOn") : t("llm.enabledStateOff")}</StatusPill>}
      >
        <div className="app-subtle-surface flex items-center justify-between rounded-2xl border border-black/5 px-4 py-4 dark:border-white/8">
          <div className="space-y-1">
            <p id="llm-enabled-label" className="text-sm font-semibold tracking-tight">{t("llm.enabled")}</p>
            <p className={fieldHintCls}>{t("llm.enabledHint")}</p>
          </div>
          <Toggle
            checked={llm.enabled}
            onChange={(v) => update({ enabled: v })}
            ariaLabelledBy="llm-enabled-label"
          />
        </div>
      </SectionCard>

      {llm.enabled ? (
        <>
          <SectionCard
            title={t("llm.providersTitle")}
            description={t("llm.providersDesc")}
            aside={<StatusPill tone="accent">{t("llm.compatibleBadge")}</StatusPill>}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <OptionCard
                title="Groq"
                description={t("llm.groqPresetDesc")}
                selected={llm.base_url.includes("groq.com")}
                onClick={() => applyPreset("groq")}
              />
              <OptionCard
                title="OpenAI"
                description={t("llm.openaiPresetDesc")}
                selected={llm.base_url.includes("openai.com")}
                onClick={() => applyPreset("openai")}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("llm.connectionTitle")} description={t("llm.connectionDesc")}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="llm-base-url" className={fieldLabelCls}>
                    {t("llm.baseUrl")}
                  </label>
                  <input
                    id="llm-base-url"
                    name="llm-base-url"
                    value={llm.base_url}
                    onChange={(e) => update({ base_url: e.target.value })}
                    className="app-input"
                    placeholder="https://api.groq.com/openai/v1"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="llm-api-key" className={fieldLabelCls}>
                    {t("llm.apiKey")}
                  </label>
                  <div className="relative">
                    <input
                      id="llm-api-key"
                      name="llm-api-key"
                      type={showKey ? "text" : "password"}
                      value={llm.api_key}
                      onChange={(e) => update({ api_key: e.target.value })}
                      className="app-input pr-20"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="app-button-ghost absolute right-2 top-2 px-3 py-1 text-xs"
                      aria-label={showKey ? t("llm.hideKey") : t("llm.showKey")}
                    >
                      {showKey ? t("llm.hideKeyShort") : t("llm.showKeyShort")}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="llm-model" className={fieldLabelCls}>
                    {t("llm.model")}
                  </label>
                  <input
                    id="llm-model"
                    name="llm-model"
                    value={llm.model}
                    onChange={(e) => update({ model: e.target.value })}
                    className="app-input"
                    placeholder="llama-3.3-70b-versatile"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <Notice title={t("llm.bestUseTitle")} tone="default">
                  {t("llm.bestUseBody")}
                </Notice>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title={t("llm.validationTitle")}
            description={t("llm.validationDesc")}
            aside={
              <StatusPill tone={testStatus === "ok" ? "success" : testStatus === "fail" ? "danger" : "default"}>
                {testStatus === "idle" ? t("llm.validationIdle") : testStatus === "testing" ? t("actions.testing") : testStatus === "ok" ? t("actions.connected") : t("llm.validationFailed")}
              </StatusPill>
            }
          >
            <div className="space-y-4">
              <button onClick={testConnection} disabled={testStatus === "testing"} className="app-button-primary">
                {testStatus === "testing" ? t("actions.testing") : t("actions.testConnection")}
              </button>

              {testStatus === "ok" ? (
                <Notice title={t("llm.validationSuccessTitle")} tone="success">
                  {testMsg || t("llm.validationSuccessBody")}
                </Notice>
              ) : null}

              {testStatus === "fail" ? (
                <Notice title={t("llm.validationFailTitle")} tone="danger">
                  {testMsg}
                </Notice>
              ) : null}
            </div>
          </SectionCard>
        </>
      ) : (
        <Notice title={t("llm.disabledNoticeTitle")} tone="default">
          {t("llm.disabledNoticeBody")}
        </Notice>
      )}
    </div>
  );
}
