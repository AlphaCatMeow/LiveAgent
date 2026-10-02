import type {
  AutomationApplyInput,
  HooksApplyResponse,
  HooksSnapshot,
} from "@liveagent/ui/lib/automation/types";
import { getConfiguredKBrainConnection } from "../kbrain/runtimeConnection";

async function request<T>(method: string, input?: AutomationApplyInput): Promise<T> {
  const connection = getConfiguredKBrainConnection();
  if (!connection) throw new Error("K-brain backend connection is not ready");
  const response = await fetch(`${connection.baseUrl.replace(/\/+$/, "")}/v1/hooks`, {
    method,
    headers: {
      Accept: "application/json",
      ...(input ? { "Content-Type": "application/json" } : {}),
      ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  if (!response.ok)
    throw new Error(`K-brain hooks request failed (${response.status}): ${await response.text()}`);
  return response.json() as Promise<T>;
}

export const fetchKBrainHooks = () => request<HooksSnapshot>("GET");
export const applyKBrainHooks = (input: AutomationApplyInput) =>
  request<HooksApplyResponse>("PUT", input);
