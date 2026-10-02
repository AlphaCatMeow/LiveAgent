import type {
  AutomationApplyInput,
  CronApplyResponse,
  CronRunNowResponse,
  CronRunRecord,
  CronSnapshot,
} from "@liveagent/ui/lib/automation/types";
import { getConfiguredKBrainConnection } from "../kbrain/runtimeConnection";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const connection = getConfiguredKBrainConnection();
  if (!connection) throw new Error("K-brain backend connection is not ready");
  const response = await fetch(`${connection.baseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      message = parsed.error || message;
    } catch {}
    throw new Error(`K-brain cron request failed (${response.status}): ${message}`);
  }
  return response.json() as Promise<T>;
}

export const fetchKBrainCron = () => request<CronSnapshot>("/v1/cron");
export const applyKBrainCron = (input: AutomationApplyInput) =>
  request<CronApplyResponse>("/v1/cron", { method: "PUT", body: JSON.stringify(input) });
export const listKBrainCronRuns = (taskId: string, limit = 100) =>
  request<{ runs?: CronRunRecord[] }>(
    `/v1/cron/${encodeURIComponent(taskId)}/runs?limit=${encodeURIComponent(String(limit))}`,
  ).then((value) => value.runs ?? []);
export const clearKBrainCronRuns = (taskId: string) =>
  request<{ clearedCount?: number }>(`/v1/cron/${encodeURIComponent(taskId)}/runs`, {
    method: "DELETE",
  }).then((value) => value.clearedCount ?? 0);
export const runKBrainCronNow = (taskId: string) =>
  request<CronRunNowResponse>(`/v1/cron/${encodeURIComponent(taskId)}/run-now`, { method: "POST" });
export const cancelKBrainCron = (taskId: string, executionId?: string) =>
  request<{ ok: boolean }>(
    executionId
      ? `/v1/cron/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(executionId)}/cancel`
      : `/v1/cron/${encodeURIComponent(taskId)}/cancel`,
    { method: "POST" },
  );
export const validateKBrainCron = (expression: string) =>
  request<{ ok: boolean }>("/v1/cron/validate", {
    method: "POST",
    body: JSON.stringify({ expression }),
  }).then(() => undefined);

export function subscribeKBrainCron(onSnapshot: (snapshot: CronSnapshot) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = -1;
  async function refresh() {
    try {
      const snapshot = await fetchKBrainCron();
      if (!stopped && snapshot.revision !== revision) {
        revision = snapshot.revision;
        onSnapshot(snapshot);
      }
    } catch (error) {
      if (!stopped) console.warn("Cron snapshot refresh failed", error);
    } finally {
      if (!stopped) timer = setTimeout(refresh, 1000);
    }
  }
  void refresh();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
