import type { CustomProvider } from "@liveagent/ui/lib/settings/types";

/**
 * Remembers legacy providers K-brain rejected during import, so a provider that can never be
 * imported as-is is not re-submitted on every launch (each attempt costs a 400 and a warning).
 *
 * A record is keyed by provider id and stores a fingerprint of the provider config. When the
 * user edits that provider (different fingerprint) it becomes eligible for import again.
 */
export const LEGACY_PROVIDER_IMPORT_STORAGE_KEY = "liveagent.kbrain-legacy-provider-import.v1";

export type RejectedLegacyProvider = {
  id: string;
  name: string;
  fingerprint: string;
  reason: string;
  rejectedAt: number;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Stable fingerprint of the parts of a provider that decide whether K-brain accepts it. */
export function legacyProviderFingerprint(provider: CustomProvider): string {
  const models = [...(provider.models ?? [])]
    .map((model) => JSON.stringify(model))
    .sort()
    .join("|");
  const source = [provider.type, provider.baseUrl, provider.isFullUrl ? "1" : "0", models].join(
    "\u0000",
  );
  // FNV-1a 32-bit: enough to detect edits, no crypto requirement.
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function readRejectedLegacyProviders(
  storage: Storage | null = defaultStorage(),
): RejectedLegacyProvider[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LEGACY_PROVIDER_IMPORT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RejectedLegacyProvider =>
        !!entry &&
        typeof entry.id === "string" &&
        typeof entry.fingerprint === "string" &&
        typeof entry.reason === "string",
    );
  } catch {
    return [];
  }
}

export function writeRejectedLegacyProviders(
  entries: readonly RejectedLegacyProvider[],
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LEGACY_PROVIDER_IMPORT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage is a best-effort cache; failing to persist only means one more retry next launch.
  }
}

/** Legacy providers still worth submitting: not previously rejected with the same config. */
export function legacyProvidersToImport(
  missing: readonly CustomProvider[],
  rejected: readonly RejectedLegacyProvider[],
): CustomProvider[] {
  const known = new Map(rejected.map((entry) => [entry.id, entry.fingerprint]));
  return missing.filter(
    (provider) => known.get(provider.id) !== legacyProviderFingerprint(provider),
  );
}

/**
 * Next rejection list: keep records still relevant (provider still missing from K-brain),
 * add/refresh the ones rejected in this attempt, drop the ones that were imported or removed.
 */
export function nextRejectedLegacyProviders(
  previous: readonly RejectedLegacyProvider[],
  stillMissing: readonly CustomProvider[],
  rejectedNow: readonly { provider: CustomProvider; reason: string }[],
  now: number = Date.now(),
): RejectedLegacyProvider[] {
  const missingIds = new Set(stillMissing.map((provider) => provider.id));
  const byId = new Map<string, RejectedLegacyProvider>();
  for (const entry of previous) {
    if (missingIds.has(entry.id)) byId.set(entry.id, entry);
  }
  for (const { provider, reason } of rejectedNow) {
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name || provider.id,
      fingerprint: legacyProviderFingerprint(provider),
      reason,
      rejectedAt: now,
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

type Listener = (entries: RejectedLegacyProvider[]) => void;

let cached: RejectedLegacyProvider[] = [];
const listeners = new Set<Listener>();

/** Latest snapshot for the settings UI; empty until the first settings load. */
export function rejectedLegacyProviders(): RejectedLegacyProvider[] {
  return cached;
}

function publish(entries: RejectedLegacyProvider[]): void {
  cached = entries;
  for (const listener of listeners) listener(entries);
}

export function subscribeRejectedLegacyProviders(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads storage and refreshes the snapshot listeners (and the UI) read from. */
export function refreshRejectedLegacyProviders(): RejectedLegacyProvider[] {
  publish(readRejectedLegacyProviders());
  return cached;
}

/** Forgets every rejection so the next settings load retries them all. */
export function clearRejectedLegacyProviders(): void {
  writeRejectedLegacyProviders([]);
  publish([]);
}
