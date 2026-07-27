import { hubFetch } from "../hubFetch";
import { isGatewayWebuiRuntime } from "../runtimeEnv";
import {
  applyCliIdentityVersion,
  CLI_IDENTITY_METADATA,
  type CliIdentityProfile,
  type CliIdentitySettings,
  compareCliVersions,
  MANAGED_CLI_IDENTITY_PROVIDER_IDS,
  type ManagedCliIdentityProviderId,
  normalizeStableCliVersion,
} from "./cliIdentityCore";

export const CLI_IDENTITY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const GATEWAY_TOKEN_STORAGE_KEY = "liveagent.gateway.token";

export type CliIdentityCheckResult =
  | { providerId: ManagedCliIdentityProviderId; status: "success"; version: string }
  | { providerId: ManagedCliIdentityProviderId; status: "error"; message: string };

function registryDistTagsUrl(packageName: string): string {
  return `https://registry.npmjs.org/-/package/${encodeURIComponent(packageName)}/dist-tags`;
}

function gatewayIdentityUrl(providerId: ManagedCliIdentityProviderId): string {
  return `${window.location.origin}/api/provider-identities/${encodeURIComponent(providerId)}/latest`;
}

function gatewayAuthHeaders(): HeadersInit {
  const token = window.localStorage.getItem(GATEWAY_TOKEN_STORAGE_KEY)?.trim() ?? "";
  if (!token) throw new Error("gateway access token is unavailable");
  return { Accept: "application/json", Authorization: `Bearer ${token}` };
}

export async function fetchLatestCliIdentityVersion(
  providerId: ManagedCliIdentityProviderId,
  signal?: AbortSignal,
): Promise<string> {
  const metadata = CLI_IDENTITY_METADATA[providerId];
  const gatewayRuntime = isGatewayWebuiRuntime();
  const response = gatewayRuntime
    ? await fetch(gatewayIdentityUrl(providerId), { headers: gatewayAuthHeaders(), signal })
    : await hubFetch(registryDistTagsUrl(metadata.packageName), {
        headers: { Accept: "application/json" },
        signal,
      });
  if (!response.ok) {
    throw new Error(`version service returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const version = normalizeStableCliVersion(
    gatewayRuntime ? payload.version : payload[metadata.distTag],
  );
  if (!version) {
    throw new Error("version service returned an invalid stable semantic version");
  }
  return version;
}

export async function checkCliIdentityVersions(
  providerIds: readonly ManagedCliIdentityProviderId[],
  signal?: AbortSignal,
): Promise<CliIdentityCheckResult[]> {
  return Promise.all(
    providerIds.map(async (providerId) => {
      try {
        return {
          providerId,
          status: "success" as const,
          version: await fetchLatestCliIdentityVersion(providerId, signal),
        };
      } catch (error) {
        return {
          providerId,
          status: "error" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export function cliIdentityProvidersNeedingCheck(
  identities: CliIdentitySettings,
  now = Date.now(),
  includeBuiltin = false,
): ManagedCliIdentityProviderId[] {
  return MANAGED_CLI_IDENTITY_PROVIDER_IDS.filter((providerId) => {
    const profile = identities[providerId];
    if (!includeBuiltin && profile.mode === "builtin") return false;
    return (
      !profile.lastCheckedAt ||
      profile.lastCheckedAt > now ||
      now - profile.lastCheckedAt >= CLI_IDENTITY_CHECK_INTERVAL_MS
    );
  });
}

export function mergeCliIdentityCheckResults(
  identities: CliIdentitySettings,
  results: readonly CliIdentityCheckResult[],
  checkedAt = Date.now(),
): {
  identities: CliIdentitySettings;
  errors: Partial<Record<ManagedCliIdentityProviderId, string>>;
  changed: boolean;
} {
  const next = { ...identities };
  const errors: Partial<Record<ManagedCliIdentityProviderId, string>> = {};
  let changed = false;
  for (const result of results) {
    if (result.status === "error") {
      errors[result.providerId] = result.message;
      continue;
    }
    const current = next[result.providerId];
    let profile: CliIdentityProfile = {
      ...current,
      latestVersion: result.version,
      lastCheckedAt: checkedAt,
    };
    if (profile.mode === "auto" && compareCliVersions(result.version, profile.version) > 0) {
      profile = applyCliIdentityVersion(profile, result.version);
    }
    next[result.providerId] = profile;
    changed =
      changed ||
      current.latestVersion !== profile.latestVersion ||
      current.lastCheckedAt !== profile.lastCheckedAt ||
      current.version !== profile.version ||
      current.previousVersion !== profile.previousVersion;
  }
  return { identities: next, errors, changed };
}
