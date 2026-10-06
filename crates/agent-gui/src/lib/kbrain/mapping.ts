import { createUuid } from "@liveagent/ui/lib/shared/id";
import { getKBrainRuntimeConnection } from "./runtimeConnection";

const mappingKey = "kbrain-session-map:v1";
const legacyKeyPrefix = "kbrain-session:";

type MappingRecord = Record<string, string>;

type MappingState = {
  localToBackend: MappingRecord;
  backendToLocal: MappingRecord;
};

export function kBrainStorageScope(baseUrl?: string) {
  const managed = getKBrainRuntimeConnection();
  const normalized = (baseUrl ?? managed?.baseUrl ?? "http://127.0.0.1:47321")
    .trim()
    .replace(/\/+$/, "");
  // The managed backend retains its storage identity across ephemeral ports.
  return managed && normalized === managed.baseUrl ? "liveagent-managed-kbrain" : normalized;
}

const normalizeBaseUrl = kBrainStorageScope;

function scopedKey(baseUrl: string, conversationId: string) {
  return `${normalizeBaseUrl(baseUrl)}\u0000${conversationId.trim()}`;
}

function readState(): MappingState {
  try {
    const raw = globalThis.localStorage?.getItem(mappingKey);
    if (!raw) return { localToBackend: {}, backendToLocal: {} };
    const parsed = JSON.parse(raw) as Partial<MappingState>;
    return {
      localToBackend:
        parsed.localToBackend && typeof parsed.localToBackend === "object"
          ? parsed.localToBackend
          : {},
      backendToLocal:
        parsed.backendToLocal && typeof parsed.backendToLocal === "object"
          ? parsed.backendToLocal
          : {},
    };
  } catch {
    return { localToBackend: {}, backendToLocal: {} };
  }
}

function writeState(state: MappingState) {
  try {
    globalThis.localStorage?.setItem(mappingKey, JSON.stringify(state));
  } catch {
    // Mapping is recoverable from the remote list; storage is optional.
  }
}

function readLegacyMapping(conversationId: string, baseUrl?: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const encodedBaseUrl = encodeURIComponent(normalizedBaseUrl);
  const encodedConversationId = encodeURIComponent(conversationId.trim());
  const prefix = `${legacyKeyPrefix}${encodedBaseUrl}:`;
  const suffix = `:${encodedConversationId}`;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return undefined;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix) || !key.endsWith(suffix)) continue;
      const value = storage.getItem(key)?.trim();
      if (value) return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function getKBrainSessionId(conversationId: string, baseUrl?: string): string | undefined {
  const localId = conversationId.trim();
  if (!localId) return undefined;
  const state = readState();
  const mapped = state.localToBackend[scopedKey(normalizeBaseUrl(baseUrl), localId)];
  if (mapped) return mapped;
  const legacy = readLegacyMapping(localId, baseUrl);
  if (legacy) {
    setKBrainSessionId(localId, legacy, baseUrl);
    return legacy;
  }
  return undefined;
}

export function setKBrainSessionId(
  conversationId: string,
  backendId: string,
  baseUrl?: string,
): string {
  const localId = conversationId.trim();
  const remoteId = backendId.trim();
  if (!localId || !remoteId)
    throw new Error("K-brain session mapping requires both local and backend IDs");
  const scope = normalizeBaseUrl(baseUrl);
  const state = readState();
  const localKey = scopedKey(scope, localId);
  const previousRemoteId = state.localToBackend[localKey];
  if (previousRemoteId && state.backendToLocal[scopedKey(scope, previousRemoteId)] === localId) {
    delete state.backendToLocal[scopedKey(scope, previousRemoteId)];
  }
  const previousLocalId = state.backendToLocal[scopedKey(scope, remoteId)];
  if (previousLocalId && previousLocalId !== localId) {
    delete state.localToBackend[scopedKey(scope, previousLocalId)];
  }
  state.localToBackend[localKey] = remoteId;
  state.backendToLocal[scopedKey(scope, remoteId)] = localId;
  writeState(state);
  return remoteId;
}

export function getKBrainConversationId(backendId: string, baseUrl?: string): string | undefined {
  const remoteId = backendId.trim();
  if (!remoteId) return undefined;
  return readState().backendToLocal[scopedKey(normalizeBaseUrl(baseUrl), remoteId)];
}

export function ensureKBrainConversationId(backendId: string, baseUrl?: string): string {
  return getKBrainConversationId(backendId, baseUrl) ?? createUuid();
}

export function clearKBrainSessionId(conversationId: string, baseUrl?: string): void {
  const localId = conversationId.trim();
  if (!localId) return;
  const scope = normalizeBaseUrl(baseUrl);
  const state = readState();
  const localKey = scopedKey(scope, localId);
  const remoteId = state.localToBackend[localKey];
  delete state.localToBackend[localKey];
  if (remoteId && state.backendToLocal[scopedKey(scope, remoteId)] === localId) {
    delete state.backendToLocal[scopedKey(scope, remoteId)];
  }
  writeState(state);
}

export function listKBrainSessionMappings(
  baseUrl?: string,
): Array<{ conversationId: string; sessionId: string }> {
  const scope = normalizeBaseUrl(baseUrl);
  const prefix = `${scope}\u0000`;
  return Object.entries(readState().localToBackend)
    .filter(([key, sessionId]) => key.startsWith(prefix) && Boolean(sessionId))
    .map(([key, sessionId]) => ({ conversationId: key.slice(prefix.length), sessionId }));
}
