import { Button } from "@liveagent/ui/components/ui/button";
import { useLocale } from "@liveagent/ui/i18n";
import { useCallback, useEffect, useState } from "react";
import type {
  AIApprovalConfig,
  KBrainSettingsAdapter,
  KBrainSettingsDocument,
} from "./kbrainSettingsAdapter";

export function AIApprovalSection({ kbrain }: { kbrain: KBrainSettingsAdapter }) {
  const { locale } = useLocale();
  const zh = locale.startsWith("zh");
  const [document, setDocument] = useState<KBrainSettingsDocument | null>(null);
  const [draft, setDraft] = useState<AIApprovalConfig>({ mode: "off" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const upgrade = zh
    ? "当前 K-brain 尚不支持 AI 智能审批，请升级后重试。"
    : "Upgrade K-brain to use AI approval.";
  const refresh = useCallback(async () => {
    setBusy(true);
    setDocument(null);
    setError("");
    setSaved(false);
    try {
      const next = await kbrain.getSettings();
      if (!next.aiApproval) throw new Error(upgrade);
      setDocument(next);
      setDraft(next.aiApproval);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [kbrain, upgrade]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const next = await kbrain.updateSettings({ aiApproval: draft });
      if (!next.aiApproval) throw new Error(upgrade);
      setDocument(next);
      setDraft(next.aiApproval);
      setSaved(true);
      window.dispatchEvent(new Event("kbrain:settings-changed"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const valid =
    draft.mode === "off" ||
    document?.models.some((m) => m.provider === draft.provider && m.id === draft.model);
  return (
    <section className="space-y-4 rounded-lg border p-4" data-testid="ai-approval-settings">
      <h2 className="font-semibold">{zh ? "AI 智能审批" : "AI approval"}</h2>
      <p className="text-sm text-muted-foreground">
        {zh
          ? "由 K-brain 独立小模型审查沙箱操作、敏感信息、模型行为和工具内容注入风险。仅风险提示不会改变原有权限；自动审批仅放行明确低风险的单次操作，不确定时请求人工确认。沙箱和明确拒绝规则始终有效。"
          : "An isolated K-brain reviewer checks sandbox operations, sensitive data, model behavior and tool-content injection. Risk-only mode preserves existing permissions. Automatic mode approves low-risk actions once and asks you when uncertain. Sandbox restrictions and explicit denials remain authoritative."}
      </p>
      {!kbrain.getConnection() && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? "当前 WebUI 传输不支持人工审批按钮；需要确认的操作会被拒绝，请在 LiveAgent 桌面端或 K-brain TUI 中继续。"
            : "This WebUI transport has no manual approval controls. Actions requiring confirmation are rejected; continue in LiveAgent desktop or K-brain TUI."}
        </p>
      )}
      <fieldset disabled={busy || !document} className="space-y-4">
        <legend className="sr-only">{zh ? "审批模式" : "Approval mode"}</legend>
        <div className="flex flex-wrap gap-4">
          {(["off", "risk_only", "auto"] as const).map((mode, i) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="ai-approval-mode"
                value={mode}
                checked={draft.mode === mode}
                onChange={() => {
                  setDraft({ ...draft, mode });
                  setSaved(false);
                }}
              />
              {
                (zh
                  ? ["关闭", "仅风险提示", "自动审批"]
                  : ["Off", "Risk warnings only", "Automatic approval"])[i]
              }
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-2 text-sm">
          {zh ? "审批模型（建议选择小模型）" : "Reviewer model (a small model is recommended)"}
          <select
            aria-label={zh ? "审批模型" : "Reviewer model"}
            className="w-full min-w-0 rounded-md border bg-background p-2"
            value={
              draft.provider && draft.model ? JSON.stringify([draft.provider, draft.model]) : ""
            }
            onChange={(e) => {
              const [provider, model] = e.target.value
                ? (JSON.parse(e.target.value) as [string, string])
                : ["", ""];
              setDraft({ ...draft, provider, model });
              setSaved(false);
            }}
          >
            <option value="">{zh ? "请选择" : "Select a model"}</option>
            {draft.provider &&
              draft.model &&
              !document?.models.some(
                (m) => m.provider === draft.provider && m.id === draft.model,
              ) && (
                <option value={JSON.stringify([draft.provider, draft.model])}>
                  {draft.provider} / {draft.model} ({zh ? "不可用" : "unavailable"})
                </option>
              )}
            {document?.models.map((m) => (
              <option
                key={JSON.stringify([m.provider, m.id])}
                value={JSON.stringify([m.provider, m.id])}
              >
                {m.provider} / {m.name || m.id}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {zh
            ? "审查会增加模型请求与费用。经过常见敏感信息脱敏的操作、用户请求和工具文本会发送给所选供应商；脱敏不能识别所有秘密。自动模式会暂扣无法确认安全的工具输出。设置在下一轮请求生效。"
            : "Review adds model requests and cost. Actions, user requests and tool text are sent to the selected provider after common sensitive values are redacted; not all secrets can be detected. Automatic mode withholds tool output that cannot be verified. Changes apply on the next turn."}
        </p>
        <Button onClick={() => void save()} disabled={!valid}>
          {zh ? "保存审批设置" : "Save approval settings"}
        </Button>
      </fieldset>
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
        {zh ? "重新加载" : "Reload"}
      </Button>
      <div role="status" aria-live="polite" className="break-words text-sm">
        {busy ? (zh ? "处理中…" : "Working…") : saved ? (zh ? "已保存" : "Saved") : ""}
      </div>
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
