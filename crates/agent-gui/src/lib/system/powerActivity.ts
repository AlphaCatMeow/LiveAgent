import { invoke } from "@tauri-apps/api/core";

function createActivityId(scope: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${scope}:${crypto.randomUUID()}`;
  }
  return `${scope}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export async function withPowerActivity<T>(scope: string, reason: string, run: () => Promise<T>) {
  const activityId = createActivityId(scope);

  try {
    await invoke("system_begin_power_activity", {
      activityId,
      reason,
    });
  } catch (error) {
    console.warn("system_begin_power_activity failed", error);
  }

  try {
    return await run();
  } finally {
    try {
      await invoke("system_end_power_activity", { activityId });
    } catch (error) {
      console.warn("system_end_power_activity failed", error);
    }
  }
}
