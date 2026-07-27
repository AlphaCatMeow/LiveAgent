export const MANAGED_CLI_IDENTITY_PROVIDER_IDS = ["claude_code", "codex", "xai"] as const;

export type ManagedCliIdentityProviderId = (typeof MANAGED_CLI_IDENTITY_PROVIDER_IDS)[number];
export type CliIdentityMode = "builtin" | "notify" | "auto";

export type CliIdentityProfile = {
  mode: CliIdentityMode;
  version: string;
  previousVersion?: string;
  latestVersion?: string;
  lastCheckedAt?: number;
};

export type CliIdentitySettings = Record<ManagedCliIdentityProviderId, CliIdentityProfile>;

export type CliIdentityMetadata = {
  packageName: string;
  distTag: "stable" | "latest";
  builtinVersion: string;
};

export const CLI_IDENTITY_METADATA: Record<ManagedCliIdentityProviderId, CliIdentityMetadata> = {
  claude_code: {
    packageName: "@anthropic-ai/claude-code",
    distTag: "stable",
    builtinVersion: "2.1.71",
  },
  codex: {
    packageName: "@openai/codex",
    distTag: "latest",
    builtinVersion: "0.72.0",
  },
  xai: {
    packageName: "@xai-official/grok",
    distTag: "latest",
    builtinVersion: "0.2.110",
  },
};

const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isManagedCliIdentityProviderId(
  value: string,
): value is ManagedCliIdentityProviderId {
  return MANAGED_CLI_IDENTITY_PROVIDER_IDS.includes(value as ManagedCliIdentityProviderId);
}

export function normalizeStableCliVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length <= 64 && STABLE_SEMVER_PATTERN.test(normalized) ? normalized : undefined;
}

function versionTuple(version: string): [bigint, bigint, bigint] {
  const match = STABLE_SEMVER_PATTERN.exec(version);
  if (!match) return [0n, 0n, 0n];
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

export function compareCliVersions(left: string, right: string): number {
  const leftTuple = versionTuple(left);
  const rightTuple = versionTuple(right);
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] !== rightTuple[index])
      return leftTuple[index] > rightTuple[index] ? 1 : -1;
  }
  return 0;
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function normalizeCliIdentityMode(value: unknown): CliIdentityMode {
  return value === "builtin" || value === "auto" || value === "notify" ? value : "notify";
}

export function getDefaultCliIdentitySettings(): CliIdentitySettings {
  return Object.fromEntries(
    MANAGED_CLI_IDENTITY_PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        mode: "notify" as const,
        version: CLI_IDENTITY_METADATA[providerId].builtinVersion,
      },
    ]),
  ) as CliIdentitySettings;
}

export function normalizeCliIdentitySettings(input: unknown): CliIdentitySettings {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(
    MANAGED_CLI_IDENTITY_PROVIDER_IDS.map((providerId) => {
      const raw =
        source[providerId] && typeof source[providerId] === "object"
          ? (source[providerId] as Record<string, unknown>)
          : {};
      const profile: CliIdentityProfile = {
        mode: normalizeCliIdentityMode(raw.mode),
        version:
          normalizeStableCliVersion(raw.version) ??
          CLI_IDENTITY_METADATA[providerId].builtinVersion,
      };
      const previousVersion = normalizeStableCliVersion(raw.previousVersion);
      const latestVersion = normalizeStableCliVersion(raw.latestVersion);
      const lastCheckedAt = normalizeTimestamp(raw.lastCheckedAt);
      if (previousVersion) profile.previousVersion = previousVersion;
      if (latestVersion) profile.latestVersion = latestVersion;
      if (lastCheckedAt) profile.lastCheckedAt = lastCheckedAt;
      return [providerId, profile];
    }),
  ) as CliIdentitySettings;
}

export function getAppliedCliIdentityVersion(
  providerId: ManagedCliIdentityProviderId,
  profile: CliIdentityProfile,
): string {
  return profile.mode === "builtin"
    ? CLI_IDENTITY_METADATA[providerId].builtinVersion
    : profile.version;
}

export function formatCliIdentityUserAgent(
  providerId: ManagedCliIdentityProviderId,
  version: string,
): string {
  const normalizedVersion =
    normalizeStableCliVersion(version) ?? CLI_IDENTITY_METADATA[providerId].builtinVersion;
  if (providerId === "claude_code") {
    return `claude-cli/${normalizedVersion} (external, cli)`;
  }
  if (providerId === "codex") {
    return `codex_cli_rs/${normalizedVersion} (Ubuntu 24.4.0; x86_64) WindowsTerminal`;
  }
  return `grok-shell/${normalizedVersion} (linux; x86_64)`;
}

export function applyCliIdentityVersion(
  profile: CliIdentityProfile,
  version: string,
): CliIdentityProfile {
  const normalizedVersion = normalizeStableCliVersion(version);
  if (!normalizedVersion || normalizedVersion === profile.version) return profile;
  return {
    ...profile,
    version: normalizedVersion,
    previousVersion: profile.version,
    latestVersion: normalizedVersion,
  };
}

export function rollbackCliIdentityVersion(profile: CliIdentityProfile): CliIdentityProfile {
  const previousVersion = normalizeStableCliVersion(profile.previousVersion);
  if (!previousVersion || previousVersion === profile.version) return profile;
  return {
    ...profile,
    version: previousVersion,
    previousVersion: profile.version,
  };
}

export function setCliIdentityMode(
  providerId: ManagedCliIdentityProviderId,
  profile: CliIdentityProfile,
  mode: CliIdentityMode,
): CliIdentityProfile {
  if (mode !== "builtin") return { ...profile, mode };
  const builtinVersion = CLI_IDENTITY_METADATA[providerId].builtinVersion;
  return {
    ...profile,
    mode,
    version: builtinVersion,
    ...(profile.version !== builtinVersion ? { previousVersion: profile.version } : {}),
  };
}

export function cliIdentityUpdateAvailable(
  providerId: ManagedCliIdentityProviderId,
  profile: CliIdentityProfile,
): boolean {
  return Boolean(
    profile.latestVersion &&
      compareCliVersions(profile.latestVersion, getAppliedCliIdentityVersion(providerId, profile)) >
        0,
  );
}
