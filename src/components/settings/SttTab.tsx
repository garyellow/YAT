import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { Notice, OptionCard, SectionCard, StatusPill } from "./SettingPrimitives";

const fieldLabelCls = "text-sm font-medium text-gray-700 dark:text-gray-200";
const fieldHintCls = "text-xs leading-5 text-gray-500 dark:text-gray-400";

export default function SttTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [showKey, setShowKey] = useState(false);

  if (!settings) return null;
  const stt = settings.stt;

  const update = (patch: Partial<typeof stt>) => {
    updateSettings({ stt: { ...stt, ...patch } });
  };

  const applyPreset = (preset: "groq" | "openai") => {
    if (preset === "groq") {
      update({
        base_url: "https://api.groq.com/openai/v1",
        model: "whisper-large-v3-turbo",
      });
      return;
    }

    update({
      base_url: "https://api.openai.com/v1",
      model: "whisper-1",
    });
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const msg = await invoke<string>("test_stt", { config: stt });
      setTestStatus("ok");
      setTestMsg(msg);
    } catch (e) {
      setTestStatus("fail");
      setTestMsg(String(e));
    }
  };

  return (
    <div className="space-y-6">
      <Notice title={t("stt.quickStartTitle")} tone="accent">
        {t("stt.quickStartDesc")}
      </Notice>

      <SectionCard
        title={t("stt.providersTitle")}
        description={t("stt.providersDesc")}
        aside={<StatusPill tone="accent">{t("stt.compatibleBadge")}</StatusPill>}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <OptionCard
            title="Groq"
            description={t("stt.groqPresetDesc")}
            selected={stt.base_url.includes("groq.com")}
            onClick={() => applyPreset("groq")}
          />
          <OptionCard
            title="OpenAI"
            description={t("stt.openaiPresetDesc")}
            selected={stt.base_url.includes("openai.com")}
            onClick={() => applyPreset("openai")}
          />
        </div>
      </SectionCard>

      <SectionCard title={t("stt.connectionTitle")} description={t("stt.connectionDesc")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="stt-base-url" className={fieldLabelCls}>
                {t("stt.baseUrl")}
              </label>
              <input
                id="stt-base-url"
                name="stt-base-url"
                value={stt.base_url}
                onChange={(e) => update({ base_url: e.target.value })}
                className="app-input"
                placeholder="https://api.groq.com/openai/v1"
                autoComplete="off"
                spellCheck={false}
              />
              <p className={fieldHintCls}>{t("stt.baseUrlHint")}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="stt-api-key" className={fieldLabelCls}>
                {t("stt.apiKey")}
              </label>
              <div className="relative">
                <input
                  id="stt-api-key"
                  name="stt-api-key"
                  type={showKey ? "text" : "password"}
                  value={stt.api_key}
                  onChange={(e) => update({ api_key: e.target.value })}
                  className="app-input pr-20"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="app-button-ghost absolute right-2 top-2 px-3 py-1 text-xs"
                  aria-label={showKey ? t("stt.hideKey") : t("stt.showKey")}
                >
                  {showKey ? t("stt.hideKeyShort") : t("stt.showKeyShort")}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="stt-model" className={fieldLabelCls}>
                {t("stt.model")}
              </label>
              <input
                id="stt-model"
                name="stt-model"
                value={stt.model}
                onChange={(e) => update({ model: e.target.value })}
                className="app-input"
                placeholder="whisper-large-v3-turbo"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="stt-language" className={fieldLabelCls}>
                {t("stt.language")}
              </label>
              <input
                id="stt-language"
                name="stt-language"
                value={stt.language ?? ""}
                onChange={(e) => update({ language: e.target.value || null })}
                className="app-input"
                placeholder="zh"
                autoComplete="off"
                spellCheck={false}
              />
              <p className={fieldHintCls}>{t("stt.languageHint")}</p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("stt.validationTitle")}
        description={t("stt.validationDesc")}
        aside={
          <StatusPill tone={testStatus === "ok" ? "success" : testStatus === "fail" ? "danger" : "default"}>
            {testStatus === "idle" ? t("stt.validationIdle") : testStatus === "testing" ? t("actions.testing") : testStatus === "ok" ? t("actions.connected") : t("stt.validationFailed")}
          </StatusPill>
        }
      >
        <div className="space-y-4">
          <button onClick={testConnection} disabled={testStatus === "testing"} className="app-button-primary">
            {testStatus === "testing" ? t("actions.testing") : t("actions.testConnection")}
          </button>

          {testStatus === "ok" ? (
            <Notice title={t("stt.validationSuccessTitle")} tone="success">
              {testMsg || t("stt.validationSuccessBody")}
            </Notice>
          ) : null}

          {testStatus === "fail" ? (
            <Notice title={t("stt.validationFailTitle")} tone="danger">
              {testMsg}
            </Notice>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
