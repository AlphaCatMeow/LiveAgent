import type { ProviderId } from "../settings";
import generatedSnapshot from "./litellm-model-metadata.generated.json";

export type LiteLlmModelMetadata = {
  contextWindow?: number;
  maxOutputToken?: number;
};

export type LiteLlmModelMap = Readonly<Record<string, LiteLlmModelMetadata>>;

type LiteLlmSnapshot = {
  schemaVersion?: unknown;
  models?: unknown;
};

const HOST_PREFIXES: Readonly<Record<string, string>> = {
  "api.cerebras.ai": "cerebras",
  "api.deepseek.com": "deepseek",
  "api.groq.com": "groq",
  "api.x.ai": "xai",
  "api.z.ai": "zai",
  "generativelanguage.googleapis.com": "gemini",
  "openrouter.ai": "openrouter",
};

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
}

function bundledModelMap(): LiteLlmModelMap {
  const snapshot = generatedSnapshot as LiteLlmSnapshot;
  if (
    snapshot.schemaVersion !== 1 ||
    !snapshot.models ||
    typeof snapshot.models !== "object" ||
    Array.isArray(snapshot.models)
  ) {
    return {};
  }
  return snapshot.models as LiteLlmModelMap;
}

function addPrefixedCandidate(candidates: string[], prefix: string, modelId: string) {
  const candidate = modelId.startsWith(`${prefix}/`) ? modelId : `${prefix}/${modelId}`;
  if (!candidates.includes(candidate)) candidates.push(candidate);
}

export function buildLiteLlmModelCandidates(
  modelId: string,
  providerType: ProviderId,
  baseUrl: string,
): string[] {
  const id = modelId.trim();
  if (!id) return [];

  const candidates: string[] = [];

  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    const prefix = HOST_PREFIXES[hostname];
    if (prefix) addPrefixedCandidate(candidates, prefix, id);
  } catch {
    // Invalid or incomplete URLs simply do not contribute a provider prefix.
  }

  if (providerType === "gemini") addPrefixedCandidate(candidates, "gemini", id);
  if (!candidates.includes(id)) candidates.push(id);

  return candidates;
}

export function getLiteLlmModelMetadata(
  modelId: string,
  providerType: ProviderId,
  baseUrl: string,
  modelMap: LiteLlmModelMap = bundledModelMap(),
): LiteLlmModelMetadata | undefined {
  for (const candidate of buildLiteLlmModelCandidates(modelId, providerType, baseUrl)) {
    if (!Object.hasOwn(modelMap, candidate)) continue;
    const value = modelMap[candidate];
    if (!value || typeof value !== "object") continue;

    const contextWindow = normalizePositiveInteger(value.contextWindow);
    const maxOutputToken = normalizePositiveInteger(value.maxOutputToken);
    if (contextWindow === undefined && maxOutputToken === undefined) return undefined;
    return {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputToken === undefined ? {} : { maxOutputToken }),
    };
  }
  return undefined;
}
