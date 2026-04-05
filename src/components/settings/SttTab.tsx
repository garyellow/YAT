import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { Notice, OptionCard, Section, StatusDot } from "./SettingPrimitives";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

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
      update({ base_url: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo" });
      return;
    }
    update({ base_url: "https://api.openai.com/v1", model: "whisper-1" });
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const msg = await invoke<string>("test_stt", { sttConfig: stt });
      setTestStatus("ok");
      setTestMsg(msg);
    } catch (e) {
      setTestStatus("fail");
      setTestMsg(String(e));
    }
  };

  return (
    <div className="space-y-10">
      <Notice title={t("stt.quickStartTitle")} tone="accent">
        {t("stt.quickStartDesc")}
      </Notice>

      {/* Providers */}
      <Section title={t("stt.providersTitle")} description={t("stt.providersDesc")}>
        <div className="grid gap-3 sm:grid-cols-2">
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
      </Section>

      {/* Connection */}
      <Section title={t("stt.connectionTitle")} description={t("stt.connectionDesc")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="stt-base-url" className={labelCls}>{t("stt.baseUrl")}</label>
              <input
                id="stt-base-url"
                name="stt-base-url"
                value={stt.base_url}
                onChange={(e) => update({ base_url: e.target.value })}
                className="field-input"
                placeholder="https://api.groq.com/openai/v1"
                autoComplete="off"
                spellCheck={false}
              />
              <p className={hintCls}>{t("stt.baseUrlHint")}</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stt-api-key" className={labelCls}>{t("stt.apiKey")}</label>
              <div className="relative">
                <input
                  id="stt-api-key"
                  name="stt-api-key"
                  type={showKey ? "text" : "password"}
                  value={stt.api_key}
                  onChange={(e) => update({ api_key: e.target.value })}
                  className="field-input pr-16"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="btn btn-ghost absolute right-1 top-1 px-2 py-1 text-xs"
                  aria-label={showKey ? t("stt.hideKey") : t("stt.showKey")}
                >
                  {showKey ? t("stt.hideKeyShort") : t("stt.showKeyShort")}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="stt-model" className={labelCls}>{t("stt.model")}</label>
              <input
                id="stt-model"
                name="stt-model"
                value={stt.model}
                onChange={(e) => update({ model: e.target.value })}
                className="field-input"
                placeholder="whisper-large-v3-turbo"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="stt-language" className={labelCls}>{t("stt.language")}</label>
              <input
                id="stt-language"
                name="stt-language"
                value={stt.language ?? ""}
                onChange={(e) => update({ language: e.target.value || null })}
                className="field-input"
                placeholder="zh"
                autoComplete="off"
                spellCheck={false}
              />
              <p className={hintCls}>{t("stt.languageHint")}</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Validation */}
      <Section
        title={t("stt.validationTitle")}
        description={t("stt.validationDesc")}
        aside={
          <StatusDot
            tone={testStatus === "ok" ? "success" : testStatus === "fail" ? "danger" : "default"}
          >
            {testStatus === "idle"
              ? t("stt.validationIdle")
              : testStatus === "testing"
                ? t("actions.testing")
                : testStatus === "ok"
                  ? t("actions.connected")
                  : t("stt.validationFailed")}
          </StatusDot>
        }
      >
        <div className="space-y-3">
          <button onClick={testConnection} disabled={testStatus === "testing"} className="btn btn-primary">
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
      </Section>
    </div>
  );
}
