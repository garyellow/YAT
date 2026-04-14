import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { Notice, PageIntro, Section, SettingList, SettingRow, StatusDot } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";
import { isLocalEndpointUrl } from "../../lib/settingsFormatters";
import { HintTip } from "../ui/Tooltip";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";
const hintCls = "text-[11px] text-[var(--text-muted)]";

export default function LlmTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [showKey, setShowKey] = useState(false);

  if (!settings) return null;
  const llm = settings.llm;
  const screenshotContextEnabled = settings.prompt.context_screenshot;
  const urlTrimmed = llm.base_url.trim();
  const isLocal = urlTrimmed ? isLocalEndpointUrl(llm.base_url) : null;
  const apiKeyHint = isLocal === null
    ? t("llm.apiKeyHint")
    : isLocal
      ? t("llm.apiKeyHintLocal")
      : t("llm.apiKeyHintRemote");
  const apiKeyDetail = isLocal === null
    ? null
    : isLocal
      ? t("llm.apiKeyHintLocal")
      : t("llm.apiKeyHintRemote");
  const serviceLabel = t("tabs.llm");
  const remoteEndpointWithoutKey = isLocal === false && !llm.api_key.trim();

  const update = (patch: Partial<typeof llm>) => {
    updateSettings({ llm: { ...llm, ...patch } });
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
      const msg = await invoke<string>("test_llm", { llmConfig: llm });
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
        title={t("tabs.llm")}
        description={t("llm.modeDesc")}
      />

      <Section>
        <SettingList>
          <SettingRow
            labelId="llm-enabled-label"
            label={t("llm.enabled")}
            description={t("llm.enabledHint")}
            control={
              <Toggle
                checked={llm.enabled}
                onChange={(v) => update({ enabled: v })}
                ariaLabelledBy="llm-enabled-label"
              />
            }
          />
        </SettingList>
      </Section>

      {llm.enabled ? (
        <>
          <Section title={t("llm.connectionTitle")} description={t("llm.connectionDesc")}>
            <div className="space-y-4">
              <div className="form-grid">
                <div className="form-block">
                  <label htmlFor="llm-base-url" className={labelCls}>{t("llm.baseUrl")}</label>
                  <input
                    id="llm-base-url"
                    name="llm-base-url"
                    type="url"
                    value={llm.base_url}
                    onChange={(e) => update({ base_url: e.target.value })}
                    className="field-input"
                    placeholder="https://api.openai.com/v1"
                    autoComplete="off"
                    inputMode="url"
                    spellCheck={false}
                  />
                  <p className={hintCls}>{t("llm.baseUrlHint")}</p>
                </div>

                <div className="form-block">
                  <label htmlFor="llm-model" className={labelCls}>{t("llm.model")}</label>
                  <input
                    id="llm-model"
                    name="llm-model"
                    value={llm.model}
                    onChange={(e) => update({ model: e.target.value })}
                    className="field-input"
                    placeholder="gpt-4o-mini"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className={hintCls}>{t("llm.modelHint")}</p>
                </div>

                <div className="form-block">
                  <label htmlFor="llm-api-key" className={`${labelCls} inline-flex items-center gap-1.5`}>
                    <span>{t("llm.apiKey")}</span>
                    {apiKeyDetail ? <HintTip text={apiKeyDetail} /> : null}
                  </label>
                  <div className="relative">
                    <input
                      id="llm-api-key"
                      name="llm-api-key"
                      type={showKey ? "text" : "password"}
                      value={llm.api_key}
                      onChange={(e) => update({ api_key: e.target.value })}
                      className="field-input pr-16"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="btn btn-ghost btn-compact absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs"
                      aria-label={showKey ? t("llm.hideKey") : t("llm.showKey")}
                      title={apiKeyHint}
                    >
                      {showKey ? t("llm.hideKeyShort") : t("llm.showKeyShort")}
                    </button>
                  </div>
                  <p className={hintCls}>{apiKeyHint}</p>
                </div>
              </div>

              {(remoteEndpointWithoutKey || screenshotContextEnabled) ? (
                <div className="form-support-stack">
                  {remoteEndpointWithoutKey ? (
                    <Notice title={t("settings.remoteApiKeyTitle")} tone="warning">
                      {t("settings.remoteApiKeyBody", { service: serviceLabel })}
                    </Notice>
                  ) : null}

                  {screenshotContextEnabled ? (
                    <Notice title={t("llm.visionNoticeTitle")} tone="warning">
                      {t("llm.visionNoticeBody")}
                    </Notice>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Section>

          <Section
            title={t("llm.validationTitle")}
            description={t("llm.validationDesc")}
            aside={
              <StatusDot
                tone={testStatus === "ok" ? "success" : testStatus === "fail" ? "danger" : "default"}
              >
                {testStatus === "idle"
                  ? t("llm.validationIdle")
                  : testStatus === "testing"
                    ? t("actions.testing")
                    : testStatus === "ok"
                      ? t("actions.connected")
                      : t("llm.validationFailed")}
              </StatusDot>
            }
          >
            <div className="space-y-3">
              <button
                type="button"
                onClick={testConnection}
                disabled={testStatus === "testing" || !llm.base_url.trim() || !llm.model.trim()}
                className="btn btn-primary"
                title={t("llm.validationDesc")}
              >
                {testStatus === "testing" ? t("actions.testing") : t("actions.testConnection")}
              </button>

              {testStatus === "ok" ? (
                <div role="status" aria-live="polite">
                  <Notice title={t("llm.validationSuccessTitle")} tone="success">
                    {testMsg || t("llm.validationSuccessBody")}
                  </Notice>
                </div>
              ) : null}

              {testStatus === "fail" ? (
                <div role="alert" aria-live="assertive">
                  <Notice title={t("llm.validationFailTitle")} tone="danger">
                    {testMsg}
                  </Notice>
                </div>
              ) : null}
            </div>
          </Section>
        </>
      ) : (
        <Notice title={t("llm.disabledNoticeTitle")} tone="default">
          {t("llm.disabledNoticeBody")}
        </Notice>
      )}
    </div>
  );
}
