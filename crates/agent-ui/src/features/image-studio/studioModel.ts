import type {
  CreateJobRequest,
  ImageAsset,
  ImageEvent,
  ImageJob,
  ImageProject,
} from "../../lib/imaging/types";

export interface FrozenSubmission {
  key: string;
  request: CreateJobRequest;
  status: "submitting" | "unknown" | "accepted";
  jobId?: string;
}
export interface StudioState {
  ownerId: string;
  backendId: string;
  projects: ImageProject[];
  jobs: Record<string, ImageJob>;
  assets: Record<string, ImageAsset>;
  selectedAssetId?: string;
  lastSeqByJob: Record<string, number>;
  snapshotNeeded: Record<string, boolean>;
}
export function initialStudioState(ownerId: string, backendId: string): StudioState {
  return {
    ownerId,
    backendId,
    projects: [],
    jobs: {},
    assets: {},
    lastSeqByJob: {},
    snapshotNeeded: {},
  };
}
export const terminalJob = (job: ImageJob) =>
  ["succeeded", "partial_succeeded", "failed", "cancelled", "result_unknown"].includes(job.status);
export const jobResultCount = (job: ImageJob) => new Set(job.assetIds).size;
function normalizeJob(job: ImageJob): ImageJob {
  const assetIds = [...new Set(job.assetIds)];
  if (["succeeded", "partial_succeeded"].includes(job.status) && !assetIds.length)
    return {
      ...job,
      assetIds,
      status: "failed",
      error: {
        code: "IMAGE_EMPTY_RESULT",
        message: "任务没有返回可用图片，请修改输入后重新生成。",
        retryable: false,
        requestId: "",
      },
    };
  return { ...job, assetIds };
}
// Newer backends attach a snapshot cursor. Older ones can be shown but cannot safely recover an event gap.
export function snapshotSequence(job: ImageJob): number | undefined {
  const value = (job as ImageJob & { lastEventSeq?: number }).lastEventSeq;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value : undefined;
}
export function applyJobSnapshot(state: StudioState, incoming: ImageJob): StudioState {
  const previous = state.jobs[incoming.id];
  if (previous && previous.revision > incoming.revision) return state;
  const seq = snapshotSequence(incoming);
  return {
    ...state,
    jobs: { ...state.jobs, [incoming.id]: normalizeJob(incoming) },
    lastSeqByJob: {
      ...state.lastSeqByJob,
      [incoming.id]: Math.max(state.lastSeqByJob[incoming.id] ?? 0, seq ?? 0),
    },
    snapshotNeeded: { ...state.snapshotNeeded, [incoming.id]: false },
  };
}
export function applyImageEvent(state: StudioState, event: ImageEvent): StudioState {
  const job = state.jobs[event.jobId];
  const previousSeq = state.lastSeqByJob[event.jobId] ?? 0;
  if (
    !Number.isSafeInteger(event.seq) ||
    !Number.isSafeInteger(event.revision) ||
    event.seq <= previousSeq ||
    (job && event.revision < job.revision)
  )
    return state;
  if (!job || event.seq !== previousSeq + 1)
    return { ...state, snapshotNeeded: { ...state.snapshotNeeded, [event.jobId]: true } };
  const asset = event.data.asset;
  let updated = { ...job, revision: event.revision, updatedAt: event.timestamp };
  if (event.type === "asset.ready" && asset)
    updated.assetIds = [...new Set([...job.assetIds, asset.id])];
  if (event.type === "item.state_changed" && event.data.itemId)
    updated.items = job.items.map((item) =>
      item.id === event.data.itemId
        ? {
            ...item,
            ...(event.data.status ? { status: event.data.status } : {}),
            ...(event.data.error ? { error: event.data.error } : {}),
          }
        : item,
    );
  if (
    (event.type === "job.state_changed" || event.type === "job.finished") &&
    event.data.status &&
    !terminalJob(job)
  )
    updated.status = event.data.status;
  if (event.data.error && event.type !== "item.state_changed") updated.error = event.data.error;
  updated = normalizeJob(updated);
  return {
    ...state,
    jobs: { ...state.jobs, [job.id]: updated },
    assets: asset ? { ...state.assets, [asset.id]: asset } : state.assets,
    lastSeqByJob: { ...state.lastSeqByJob, [job.id]: event.seq },
  };
}
export function freezeSubmission(
  previous: FrozenSubmission | null,
  request: CreateJobRequest,
  key: () => string,
  explicitlyNew = false,
): FrozenSubmission {
  if (previous && !explicitlyNew) return previous;
  const frozen = {
    ...request,
    parameters: Object.freeze({ ...request.parameters }),
    inputs: Object.freeze(request.inputs.map((input) => Object.freeze({ ...input }))),
  };
  return { key: key(), request: Object.freeze(frozen) as CreateJobRequest, status: "submitting" };
}
export const markSubmissionUnknown = (submission: FrozenSubmission): FrozenSubmission => ({
  ...submission,
  status: "unknown",
});
export function submissionWasRejected(error: unknown): error is { code: string; status: number } {
  if (!error || typeof error !== "object" || !("status" in error) || !("code" in error))
    return false;
  const codes = [
    "IMAGE_INVALID_INPUT",
    "IMAGE_UNSUPPORTED_OPERATION",
    "IMAGE_AUTH_REQUIRED",
    "IMAGE_FORBIDDEN",
    "IMAGE_NOT_FOUND",
    "IMAGE_RATE_LIMITED",
    "IMAGE_REVISION_CONFLICT",
    "IMAGE_IDEMPOTENCY_CONFLICT",
    "IMAGE_TOO_LARGE",
  ];
  return (
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}
export function errorAction(error: { code?: string } | undefined): string {
  const code = error?.code ?? "";
  if (/401|403|AUTH|CREDENTIAL|FORBIDDEN/.test(code)) return "请前往图像设置检查连接与认证。";
  if (/429|RATE|QUOTA/.test(code)) return "请等待限额恢复后再操作。";
  if (/422|PARAMETER|INVALID/.test(code)) return "请修改提示词、参数或输入图片。";
  if (/UNKNOWN|UNCERTAIN/.test(code))
    return "请先核对任务状态；明确重新生成会创建新任务，可能再次计费。";
  if (/EVENT_GAP/.test(code)) return "事件历史已过期，请重新获取任务快照。";
  return "请刷新核对任务；确认后可修改输入重新生成。";
}
export const statusLabels: Record<ImageJob["status"], string> = {
  queued: "排队中",
  running: "生成中",
  saving: "保存中",
  succeeded: "已完成",
  partial_succeeded: "部分完成",
  failed: "失败",
  cancel_requested: "正在取消",
  cancelled: "已取消",
  result_unknown: "结果未知",
};
