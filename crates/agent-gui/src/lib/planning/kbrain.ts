import { invoke } from "@liveagent/app/shims/tauriCore";
import { isTauriHost } from "../host";
import { kBrainStorageScope } from "../kbrain/mapping";
import { fetchKBrain } from "../kbrain/transport";
import {
  followBrowserTimeZone,
  rememberTimeZonePreference,
  timeZonePreference,
} from "./browserTimeZone";
import { observeTimeZoneResponse, reportTimeZoneFailure } from "./timeZoneNotice";

const migrations = new Map<string, Promise<void>>();

async function migrateOnDemand(action: string) {
  if (
    !isTauriHost() ||
    !(
      ["query", "export", "mutate", "import"].includes(action) || action.startsWith("subscription.")
    )
  )
    return;
  const scope = kBrainStorageScope();
  let pending = migrations.get(scope);
  if (!pending) {
    pending = invoke<void>("planning_migrate_legacy");
    migrations.set(scope, pending);
  }
  try {
    await pending;
  } catch (error) {
    migrations.delete(scope);
    throw error;
  }
}

export async function requestPlanning<T>(action: string, input: unknown = {}): Promise<T> {
  const scope = kBrainStorageScope();
  try {
    let result = await sendPlanning<T>(action, input);
    if (!isTauriHost()) result = await followBrowser(scope, action, result);
    observeTimeZoneResponse(scope, action, result);
    return result;
  } catch (error) {
    reportTimeZoneFailure(scope, error);
    throw error;
  }
}

/** Browser host: an automatic preference follows this computer's zone (see browserTimeZone). */
async function followBrowser<T>(scope: string, action: string, result: T): Promise<T> {
  if (action === "timezone.get" || action === "timezone") {
    const preference = (result as { preference?: unknown } | null)?.preference;
    if (typeof preference !== "string") return result;
    rememberTimeZonePreference(scope, preference);
    return followBrowserTimeZone(action, result, preference);
  }
  if (action !== "query") return result;
  const preference = await timeZonePreference(scope, () =>
    sendPlanning<{ preference?: unknown }>("timezone.get", {}),
  );
  return followBrowserTimeZone(action, result, preference);
}

async function sendPlanning<T>(action: string, input: unknown): Promise<T> {
  await migrateOnDemand(action);
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
