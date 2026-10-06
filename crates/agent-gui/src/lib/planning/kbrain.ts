import { fetchKBrain } from "../kbrain/transport";

export async function requestPlanning<T>(action: string, input: unknown = {}): Promise<T> {
  const response = await fetchKBrain(
    "/v1/planning",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, input }),
    },
    {},
    ["query", "export", "cron.occurrences", "timezone.get"].includes(action),
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `K-brain Planning request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
