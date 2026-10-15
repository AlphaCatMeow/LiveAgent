import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type {
  ImageProject,
  ImageStudioClient,
  ImageTarget,
  TargetVerificationReceipt,
  TargetVerificationRequest,
} from "../../lib/imaging/types";
import { imageSettingsError } from "./imageSettingsAdapter";

type VerificationAttempt = {
  input: TargetVerificationRequest;
  key: string;
  receipt?: TargetVerificationReceipt;
};
const attempts = new WeakMap<ImageStudioClient, Map<string, VerificationAttempt>>();

const labels: Record<string, string> = {
  pending: "执行中",
  verified: "验证通过",
  failed: "验证失败",
  unknown: "结果未知",
  stale: "配置已变化",
  blocked: "结果未满足验证要求",
};
export function ImageTargetVerification({
  client,
  target,
  revision,
  disabled,
  onVerified,
  onEnable,
}: {
  client: ImageStudioClient;
  target: ImageTarget;
  revision: number;
  disabled: boolean;
  onVerified: () => void;
  onEnable: () => void;
}) {
  const cache = attempts.get(client) ?? new Map<string, VerificationAttempt>();
  if (!attempts.has(client)) attempts.set(client, cache);
  let previous = cache.get(target.id);
  let restoreError = "";
  if (!previous && client.loadVerificationAttempt) {
    try {
      previous = client.loadVerificationAttempt(target.id) ?? undefined;
      if (previous) cache.set(target.id, previous);
    } catch (e) {
      restoreError = imageSettingsError(e);
    }
  }
  const promptId = useId();
  const receiptInputId = useId();
  const [projects, setProjects] = useState<ImageProject[]>([]);
  const [projectId, setProjectId] = useState(previous?.input.projectId ?? "");
  const [prompt, setPrompt] = useState(
    previous?.input.prompt ?? "生成一张蓝色几何风格海报，中央留白",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState<TargetVerificationReceipt | null>(
    previous?.receipt ?? null,
  );
  const [receiptId, setReceiptId] = useState(previous?.receipt?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(restoreError);
  const active = useRef(true);
  const lock = useRef(false);
  const frozen = useRef<VerificationAttempt | null>(previous ?? null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const durableUnavailable = client.hasVerificationPersistence?.() === false;
  const c = target.capabilities;
  const supported =
    target.kind === "model" &&
    target.adapterVersion === "1" &&
    ((target.adapter === "runninghub-model" &&
      target.remoteId === "rhart-image-n-g31-flash-lite-official") ||
      (target.adapter === "rolldek-images" &&
        ["gpt-image-2", "gpt-image-2.5"].includes(target.remoteId)) ||
      (target.adapter === "openai-images" &&
        ["gpt-image-2", "gpt-image-2-2026-04-21"].includes(target.remoteId)) ||
      (target.adapter === "volcengine-ark-image" &&
        target.remoteId === "doubao-seedream-5-0-pro-260628") ||
      (target.adapter === "google-generate-content-image" &&
        target.remoteId === "gemini-nano-banana-2.1")) &&
    target.parameters.length === 0 &&
    c.operations.length === 1 &&
    c.operations[0] === "generate" &&
    c.maxCount === 1 &&
    c.maxInputs === 0 &&
    c.outputFormats.length === 1 &&
    c.outputFormats[0] === "png" &&
    !c.supportsCancel &&
    !c.supportsReconcile &&
    !c.supportsContinuation &&
    !c.supportsPreview;
  async function loadProjects() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const page = await client.listProjects();
      if (active.current) {
        setProjects(page.items);
        setProjectId(page.items[0]?.id ?? "");
      }
    } catch (e) {
      if (active.current) setError(imageSettingsError(e));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function start() {
    if (
      lock.current ||
      disabled ||
      durableUnavailable ||
      !supported ||
      !confirmed ||
      !client.startTargetVerification
    )
      return;
    if (!frozen.current) {
      if (!projectId || !prompt.trim()) return;
      frozen.current = {
        key: crypto.randomUUID(),
        input: {
          expectedRevision: revision,
          projectId,
          connectionId: target.connectionId,
          remoteId: target.remoteId,
          targetRevision: target.revision,
          operation: "generate",
          count: 1,
          prompt,
          confirmPaid: true,
        },
      };
    }
    cache.set(target.id, frozen.current);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await client.startTargetVerification(
        target.id,
        frozen.current.input,
        frozen.current.key,
      );
      frozen.current.receipt = result;
      if (active.current) {
        setReceipt(result);
        setReceiptId(result.id);
      }
    } catch (e) {
      if (active.current) setError(imageSettingsError(e));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function refreshReceipt() {
    if (lock.current || (!receiptId && !frozen.current)) return;
    if (receiptId ? !client.getTargetVerification : !client.getTargetVerificationByKey) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let result: TargetVerificationReceipt;
      if (receiptId && client.getTargetVerification) {
        result = await client.getTargetVerification(target.id, receiptId.trim());
      } else if (frozen.current && client.getTargetVerificationByKey) {
        result = await client.getTargetVerificationByKey(target.id, frozen.current.key);
      } else {
        return;
      }
      if (!active.current) return;
      setReceiptId(result.id);
      if (frozen.current && frozen.current.receipt?.id === result.id)
        frozen.current.receipt = result;
      if (active.current) {
        setReceipt(result);
        if (result.state === "verified") onVerified();
      }
    } catch (e) {
      if (active.current) setError(imageSettingsError(e));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  function newVerification() {
    if (!client.clearVerificationAttempt || lock.current) return;
    if (!window.confirm("开始新的验证会创建新请求，并可能再次收费。确定继续？")) return;
    try {
      client.clearVerificationAttempt(target.id);
      cache.delete(target.id);
      frozen.current = null;
      setReceipt(null);
      setReceiptId("");
      setConfirmed(false);
      setError("");
    } catch (e) {
      setError(imageSettingsError(e));
    }
  }
  const canRestart =
    receipt &&
    receipt.state !== "unknown" &&
    (receipt.state === "verified" ||
      ["failed", "succeeded", "partial_succeeded", "cancelled"].includes(receipt.jobStatus ?? ""));
  return (
    <section className="space-y-3 rounded-md border p-3" aria-label="目标实际验证">
      <p className="text-sm font-medium">目标实际验证</p>
      <p className="text-xs text-muted-foreground">
        {target.remoteId} · 提交一次请求，验证要求 1 张
        PNG。实际费用以供应商为准，验证通过后仍需手动启用目标。
      </p>
      {!supported && (
        <p className="text-xs">
          当前后端仅接受已核对的 OpenAI、RollDek、方舟、Google 和 RunningHub 模型
          最小单图配置。其他目标暂不提供实际验证入口。
        </p>
      )}
      {durableUnavailable && (
        <p className="text-xs text-destructive">
          浏览器存储不可用，无法保留收费请求记录。暂不能提交新的验证，请先恢复存储权限。
        </p>
      )}
      {disabled && <p className="text-xs">请先保存设置，验证使用已保存的配置。</p>}
      <Button
        variant="outline"
        disabled={busy || !!frozen.current}
        onClick={() => void loadProjects()}
      >
        载入设计项目
      </Button>
      <label className="block text-xs">
        设计项目
        <select
          aria-label="验证设计项目"
          className="mt-1 w-full rounded-md border p-2"
          value={projectId}
          disabled={busy || !!frozen.current}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">请选择已有项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={promptId} className="block text-xs">
        验证提示词
        <Input
          id={promptId}
          aria-label="验证提示词"
          value={prompt}
          disabled={busy || !!frozen.current}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        我确认提交一次可能收费的图片生成请求
      </label>
      <Button
        disabled={
          busy ||
          disabled ||
          durableUnavailable ||
          !supported ||
          !confirmed ||
          (!frozen.current && (!projectId || !prompt.trim())) ||
          !client.startTargetVerification
        }
        onClick={() => void start()}
      >
        {frozen.current ? "用原请求核对提交" : "提交验证"}
      </Button>
      {frozen.current && (
        <p className="text-xs">
          请求已冻结，不自动重发。优先使用下方只读查询；再次核对提交也只会使用原幂等键。
        </p>
      )}
      <label htmlFor={receiptInputId} className="block text-xs">
        验证收据 ID
        <Input
          id={receiptInputId}
          aria-label="验证收据 ID"
          value={receiptId}
          disabled={busy}
          onChange={(e) => setReceiptId(e.target.value)}
        />
      </label>
      <Button
        variant="outline"
        disabled={
          busy ||
          (!receiptId.trim() && !frozen.current) ||
          (receiptId.trim() ? !client.getTargetVerification : !client.getTargetVerificationByKey)
        }
        onClick={() => void refreshReceipt()}
      >
        查询收据（不重新生成）
      </Button>
      {receipt && (
        <p role="status" className="text-sm">
          {labels[receipt.state] ?? receipt.state} · {receipt.id}
          {receipt.jobId ? ` · 任务 ${receipt.jobId}` : ""}
          {receipt.reason ? ` · ${receipt.reason}` : ""}
        </p>
      )}
      {receipt?.state === "verified" && !target.enabled && (
        <Button disabled={disabled || busy} onClick={onEnable}>
          启用目标（保存后生效）
        </Button>
      )}
      {canRestart && client.clearVerificationAttempt && (
        <Button variant="outline" disabled={busy || disabled} onClick={newVerification}>
          开始新的验证
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
