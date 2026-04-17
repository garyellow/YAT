import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { Notice, PageIntro, Section, StatusDot } from "./SettingPrimitives";
import { isLocalEndpointUrl } from "../../lib/settingsFormatters";
import { HintTip } from "../ui/Tooltip";

const labelCls = "text-xs font-medium text-(--text-secondary)";
const hintCls = "text-[11px] text-(--text-muted)";

export default function SttTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [showKey, setShowKey] = useState(false);

  if (!settings) return null;
  const stt = settings.stt;
  const urlTrimmed = stt.base_url.trim();
  const isLocal = urlTrimmed ? isLocalEndpointUrl(stt.base_url) : null;
  const apiKeyHint = isLocal === null
    ? t("stt.apiKeyHint")
    : isLocal
      ? t("stt.apiKeyHintLocal")
      : t("stt.apiKeyHintRemote");
  const apiKeyDetail = isLocal === null
    ? null
    : isLocal
      ? t("stt.apiKeyHintLocal")
      : t("stt.apiKeyHintRemote");
  const serviceLabel = t("tabs.stt");
  const remoteEndpointWithoutKey = isLocal === false && !stt.api_key.trim();

  const update = (patch: Partial<typeof stt>) => {
    updateSettings({ stt: { ...stt, ...patch } });
  };

  const formatConnectionError = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);
    const normalized = raw.toLowerCase();

    if (/timeout|timed out|deadline exceeded/.test(normalized)) {
      return t("settings.connectionErrorTimeout", { service: serviceLabel });
    }
    if (/401|unauthorized|authentication|invalid api key|api key required/.test(normalized)) {
      return t("settings.connectionErrorUnauthorized", { service: serviceLabel });
    }
    if (/403|forbidden|permission denied|insufficient/.test(normalized)) {
      return t("settings.connectionErrorForbidden", { service: serviceLabel });
    }
    if (/404|not found|no such model|model_not_found/.test(normalized)) {
      return t("settings.connectionErrorNotFound", { service: serviceLabel });
    }
    if (/connection|network|dns|refused|socket|unreachable|failed to fetch/.test(normalized)) {
      return t("settings.connectionErrorNetwork", { service: serviceLabel });
    }

    return t("settings.connectionErrorUnknown", { service: serviceLabel, error: raw });
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const msg = await invoke<string>("test_stt", { sttConfig: stt });
      setTestStatus("ok");
      setTestMsg(msg);
    } catch (e) {
      setTestStatus("fail");
      setTestMsg(formatConnectionError(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageIntro
        eyebrow={t("settings.groups.capture")}
        title={t("tabs.stt")}
        description={t("stt.quickStartDesc")}
      />

      <Section title={t("stt.connectionTitle")} description={t("stt.connectionDesc")}>
        <div className="space-y-4">
          <div className="form-grid">
            <div className="form-block">
              <label htmlFor="stt-base-url" className={labelCls}>{t("stt.baseUrl")}</label>
              <input
                id="stt-base-url"
                name="stt-base-url"
                type="url"
                value={stt.base_url}
                onChange={(e) => update({ base_url: e.target.value })}
                className="field-input"
                placeholder="https://api.openai.com/v1"
                autoComplete="off"
                inputMode="url"
                spellCheck={false}
              />
              <p className={hintCls}>{t("stt.baseUrlHint")}</p>
            </div>

            <div className="form-block">
              <label htmlFor="stt-model" className={labelCls}>{t("stt.model")}</label>
              <input
                id="stt-model"
                name="stt-model"
                value={stt.model}
                onChange={(e) => update({ model: e.target.value })}
                className="field-input"
                placeholder="whisper-1"
                autoComplete="off"
                spellCheck={false}
              />
              <p className={hintCls}>{t("stt.modelHint")}</p>
            </div>

            <div className="form-block">
              <label htmlFor="stt-api-key" className={`${labelCls} inline-flex items-center gap-1.5`}>
                <span>{t("stt.apiKey")}</span>
                {apiKeyDetail ? <HintTip text={apiKeyDetail} /> : null}
              </label>
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
                  className="btn btn-ghost btn-compact absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs"
                  aria-label={showKey ? t("stt.hideKey") : t("stt.showKey")}
                  title={apiKeyHint}
                >
                  {showKey ? t("stt.hideKeyShort") : t("stt.showKeyShort")}
                </button>
              </div>
              {apiKeyDetail === null ? <p className={hintCls}>{apiKeyHint}</p> : null}
            </div>

            <div className="form-block">
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

          {remoteEndpointWithoutKey ? (
            <div className="form-support-stack">
              <Notice title={t("settings.remoteApiKeyTitle")} tone="warning">
                {t("settings.remoteApiKeyBody", { service: serviceLabel })}
              </Notice>
            </div>
          ) : null}
        </div>
      </Section>

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
          <button
            type="button"
            onClick={testConnection}
            disabled={testStatus === "testing" || !stt.base_url.trim() || !stt.model.trim()}
            className="btn btn-primary"
            title={t("stt.validationDesc")}
          >
            {testStatus === "testing" ? t("actions.testing") : t("actions.testConnection")}
          </button>

          {testStatus === "ok" ? (
            <div role="status" aria-live="polite">
              <Notice title={t("stt.validationSuccessTitle")} tone="success">
                {testMsg || t("stt.validationSuccessBody")}
              </Notice>
            </div>
          ) : null}

          {testStatus === "fail" ? (
            <div role="alert" aria-live="assertive">
              <Notice title={t("stt.validationFailTitle")} tone="danger">
                {testMsg}
              </Notice>
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
