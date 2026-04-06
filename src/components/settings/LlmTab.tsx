import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { Notice, Section, StatusDot } from "./SettingPrimitives";
import Toggle from "../ui/Toggle";
import { HintTip } from "../ui/Tooltip";

const labelCls = "text-xs font-medium text-[var(--text-secondary)]";

export default function LlmTab() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "fail">("idle");

  if (!settings) return null;
  const llm = settings.llm;

  const update = (patch: Partial<typeof llm>) => {
    updateSettings({ llm: { ...llm, ...patch } });
  };

  const fetchModels = async () => {
    if (!llm.base_url || !llm.api_key) {
      setFetchStatus("fail");
      return;
    }
    setFetchStatus("loading");
    try {
      const list = await invoke<string[]>("fetch_models", {
        baseUrl: llm.base_url,
        apiKey: llm.api_key,
      });
      setModels(list);
      setFetchStatus("idle");
    } catch {
      setModels([]);
      setFetchStatus("fail");
    }
  };

  const testConnection = async () => {
    setTestStatus("testing");
    try {
      const msg = await invoke<string>("test_llm", { llmConfig: llm });
      setTestStatus("ok");
      setTestMsg(msg);
    } catch (e) {
      setTestStatus("fail");
      setTestMsg(String(e));
    }
  };

  return (
    <div className="space-y-10">
      <Notice title={t("llm.quickStartTitle")} tone="accent">
        {t("llm.quickStartDesc")}
      </Notice>

      {/* Enable/Disable */}
      <Section
        title={t("llm.modeTitle")}
        description={t("llm.modeDesc")}
        aside={
          <StatusDot tone={llm.enabled ? "accent" : "default"}>
            {llm.enabled ? t("llm.enabledStateOn") : t("llm.enabledStateOff")}
          </StatusDot>
        }
      >
        <div className="flex items-center justify-between gap-4 py-1">
          <div>
              <p id="llm-enabled-label" className="text-[13px] font-medium">{t("llm.enabled")} <HintTip text={t("llm.enabledHint")} /></p>
          </div>
          <Toggle checked={llm.enabled} onChange={(v) => update({ enabled: v })} ariaLabelledBy="llm-enabled-label" />
        </div>
      </Section>

      {llm.enabled ? (
        <>
          {/* Connection */}
          <Section title={t("llm.connectionTitle")} description={t("llm.connectionDesc")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="llm-base-url" className={labelCls}>{t("llm.baseUrl")} <span className="text-[var(--red)]">*</span></label>
                  <input
                    id="llm-base-url"
                    name="llm-base-url"
                    value={llm.base_url}
                    onChange={(e) => update({ base_url: e.target.value })}
                    className="field-input"
                    placeholder="https://api.openai.com/v1"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="llm-api-key" className={labelCls}>{t("llm.apiKey")} <span className="text-[var(--red)]">*</span></label>
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
                      className="btn btn-ghost absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs"
                      aria-label={showKey ? t("llm.hideKey") : t("llm.showKey")}
                    >
                      {showKey ? t("llm.hideKeyShort") : t("llm.showKeyShort")}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="llm-model" className={labelCls}>{t("llm.model")} <span className="text-[var(--red)]">*</span> <HintTip text={t("llm.modelHint")} /></label>
                  <div className="flex gap-2">
                    <input
                      id="llm-model"
                      name="llm-model"
                      list="llm-model-list"
                      value={llm.model}
                      onChange={(e) => update({ model: e.target.value })}
                      className="field-input flex-1"
                      placeholder="gpt-4o-mini"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={fetchModels}
                      disabled={!llm.base_url || !llm.api_key || fetchStatus === "loading"}
                      className="btn btn-ghost shrink-0 text-xs"
                    >
                      {fetchStatus === "loading" ? t("llm.fetchingModels") : t("llm.fetchModels")}
                    </button>
                  </div>
                  {models.length > 0 && (
                    <datalist id="llm-model-list">
                      {models.map((m) => <option key={m} value={m} />)}
                    </datalist>
                  )}
                  {fetchStatus === "fail" && (
                    <p className="text-[11px] text-[var(--red)]">{t("llm.fetchModelsFail")}</p>
                  )}

                </div>

                <Notice title={t("llm.bestUseTitle")} tone="default">
                  {t("llm.bestUseBody")}
                </Notice>
              </div>
            </div>
          </Section>

          {/* Validation */}
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
              <button onClick={testConnection} disabled={testStatus === "testing"} className="btn btn-primary">
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
