import { hubFetch } from "../hubFetch";
import {
  CLI_IDENTITY_METADATA,
  type ManagedCliIdentityProviderId,
  normalizeStableCliVersion,
} from "./cliIdentityCore";

export type CliIdentityCheckResult =
  | { providerId: ManagedCliIdentityProviderId; status: "success"; version: string }
  | { providerId: ManagedCliIdentityProviderId; status: "error"; message: string };

function registryDistTagsUrl(packageName: string): string {
  return `https://registry.npmjs.org/-/package/${packageName.replace("/", "%2F")}/dist-tags`;
}

export async function fetchLatestCliIdentityVersion(
  providerId: ManagedCliIdentityProviderId,
  signal?: AbortSignal,
): Promise<string> {
  const metadata = CLI_IDENTITY_METADATA[providerId];
  const response = await hubFetch(registryDistTagsUrl(metadata.packageName), {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const version = normalizeStableCliVersion(payload[metadata.distTag]);
  if (!version) {
    throw new Error(`npm dist-tag ${metadata.distTag} is not a stable semantic version`);
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
