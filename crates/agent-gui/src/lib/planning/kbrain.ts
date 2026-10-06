import { getConfiguredKBrainConnection } from "../kbrain/runtimeConnection";

export async function requestPlanning<T>(action: string, input: unknown = {}): Promise<T> {
  const connection = getConfiguredKBrainConnection();
  if (!connection) throw new Error("K-brain backend connection is not ready");
  const response = await fetch(`${connection.baseUrl.replace(/\/+$/, "")}/v1/planning`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
    },
    body: JSON.stringify({ action, input }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `K-brain Planning request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
