import { invoke } from "@tauri-apps/api/core";
import { prepareProxyRequest } from "../../lib/providers/proxy";
import {
  createProviderModelConfig,
  normalizeProviderModelConfigs,
  type ProviderId,
  type ProviderModelConfig,
} from "../../lib/settings";
import { normalizeBaseUrl } from "../../lib/settings/normalize";

const GATEWAY_WEBUI_MARKER = "gateway";
const GATEWAY_TOKEN_STORAGE_KEY = "liveagent.gateway.token";
const CODEX_MODELS_SUFFIXES = ["/chat/completions", "/responses", "/response"];
const GEMINI_GENERATE_SUFFIXES = [":streamGenerateContent", ":generateContent"];

export function isGatewayWebuiRuntime() {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.liveagentWebui === GATEWAY_WEBUI_MARKER
  );
}

function normalizeModelBaseUrl(type: ProviderId, baseUrl: string) {
  let normalizedUrl = normalizeBaseUrl(baseUrl);

  if (type !== "codex" && type !== "gemini") {
    return normalizedUrl;
  }

  const lower = normalizedUrl.toLowerCase();

  if (type === "codex") {
    for (const suffix of CODEX_MODELS_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        normalizedUrl = normalizedUrl.slice(0, -suffix.length);
        break;
      }
    }
  } else {
    for (const suffix of GEMINI_GENERATE_SUFFIXES) {
      if (lower.endsWith(suffix.toLowerCase())) {
        normalizedUrl = normalizedUrl.slice(0, -suffix.length);
        break;
      }
    }
    const modelsIndex = normalizedUrl.toLowerCase().lastIndexOf("/models");
    if (modelsIndex >= 0) {
      const afterModels = normalizedUrl.slice(modelsIndex + "/models".length);
      if (!afterModels || afterModels.startsWith("/")) {
        normalizedUrl = normalizedUrl.slice(0, modelsIndex);
      }
    }
  }

  return normalizeBaseUrl(normalizedUrl);
}

function buildModelsUrl(type: ProviderId, baseUrl: string) {
  if (type === "gemini") {
    const normalizedUrl = normalizeBaseUrl(baseUrl);
    if (normalizedUrl.toLowerCase().endsWith("/models")) return normalizedUrl;
    if (/\/v\d+(?:beta)?$/i.test(normalizedUrl)) return `${normalizedUrl}/models`;
    return `${normalizedUrl}/v1beta/models`;
  }

  return baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
}

async function readFetchError(response: Response, fallback: string) {
  const raw = (await response.text()).trim();
  if (!raw) {
    return fallback;
  }

  try {
    const payload = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const errorText =
      typeof payload.error === "string"
        ? payload.error.trim()
        : typeof payload.message === "string"
          ? payload.message.trim()
          : "";
    return errorText || raw;
  } catch {
    return raw;
  }
}

async function fetchModelsThroughGateway(
  type: ProviderId,
  baseUrl: string,
  apiKey: string,
): Promise<ProviderModelConfig[]> {
  const token =
    typeof window !== "undefined"
      ? (window.localStorage.getItem(GATEWAY_TOKEN_STORAGE_KEY) ?? "").trim()
      : "";
  if (!token) {
    throw new Error("Gateway token is required");
  }

  const data = await invoke<unknown>("gateway_provider_models", {
    type,
    base_url: baseUrl,
    api_key: apiKey,
  } as any);

  if (Array.isArray((data as { data?: unknown[] } | null)?.data)) {
    return normalizeFetchedModels((data as { data: unknown[] }).data, type);
  }
  if (Array.isArray((data as { models?: unknown[] } | null)?.models)) {
    return normalizeFetchedModels((data as { models: unknown[] }).models, type);
  }
  if (Array.isArray(data)) {
    return normalizeFetchedModels(data, type);
  }

  const maybeError =
    data && typeof data === "object" && "error" in (data as Record<string, unknown>)
      ? (data as Record<string, unknown>).error
      : null;
  if (typeof maybeError === "string" && maybeError.trim() !== "") {
    throw new Error(maybeError);
  }

  return [];
}

export function normalizeFetchedModels(
  items: unknown,
  providerType: ProviderId,
): ProviderModelConfig[] {
  if (providerType === "gemini") {
    return normalizeGeminiFetchedModels(items);
  }
  return normalizeProviderModelConfigs(items, providerType);
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
}

function normalizeGeminiModelId(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function normalizeGeminiFetchedModels(items: unknown): ProviderModelConfig[] {
  if (!Array.isArray(items)) return [];

  const out: ProviderModelConfig[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const obj = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const supportedMethods = Array.isArray(obj.supportedGenerationMethods)
      ? obj.supportedGenerationMethods.filter((value): value is string => typeof value === "string")
      : [];
    if (supportedMethods.length > 0 && !supportedMethods.includes("generateContent")) {
      continue;
    }

    const id = normalizeGeminiModelId(obj.name ?? obj.id ?? obj.model);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const draft = createProviderModelConfig("gemini", id);
    out.push({
      id,
      contextWindow: normalizePositiveInteger(obj.inputTokenLimit) ?? draft.contextWindow,
      maxOutputToken: normalizePositiveInteger(obj.outputTokenLimit) ?? draft.maxOutputToken,
    });
  }

  return out;
}

export function mergeFetchedModels(
  fetched: ProviderModelConfig[],
  existing: ProviderModelConfig[],
): ProviderModelConfig[] {
  const merged: ProviderModelConfig[] = [];
  const existingById = new Map(existing.map((model) => [model.id, model]));
  const seen = new Set<string>();

  for (const model of fetched) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(existingById.get(model.id) ?? model);
  }

  for (const model of existing) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

export function sortModelsBySelection(
  models: ProviderModelConfig[],
  activeModels: ReadonlySet<string>,
): ProviderModelConfig[] {
  const selected: ProviderModelConfig[] = [];
  const unselected: ProviderModelConfig[] = [];

  for (const model of models) {
    if (activeModels.has(model.id)) selected.push(model);
    else unselected.push(model);
  }

  return [...selected, ...unselected];
}

export function createDraftModelConfig(
  providerType: ProviderId,
  modelId: string,
): ProviderModelConfig {
  return createProviderModelConfig(providerType, modelId);
}

export async function fetchModelsFromApi(
  type: ProviderId,
  baseUrl: string,
  apiKey: string,
): Promise<ProviderModelConfig[]> {
  const normalizedUrl = normalizeModelBaseUrl(type, baseUrl);
  const normalizedApiKey = apiKey.trim();
  if (isGatewayWebuiRuntime()) {
    return fetchModelsThroughGateway(type, normalizedUrl, normalizedApiKey);
  }

  const headers: Record<string, string> =
    type === "gemini"
      ? {
          "Content-Type": "application/json",
          "x-goog-api-key": normalizedApiKey,
        }
      : {
          "Content-Type": "application/json",
          Authorization: `Bearer ${normalizedApiKey}`,
          "x-api-key": normalizedApiKey,
        };

  if (type === "claude_code") {
    headers["anthropic-version"] = "2023-06-01";
  }

  const proxyRequest = await prepareProxyRequest(type, normalizedUrl, headers);
  const proxyUrl = buildModelsUrl(type, proxyRequest.baseUrl);

  const res = await fetch(proxyUrl, { headers: proxyRequest.headers });
  if (!res.ok) {
    throw new Error(await readFetchError(res, `HTTP ${res.status} ${res.statusText}`));
  }
  const data = await res.json();

  if (Array.isArray(data.data)) {
    return normalizeFetchedModels(data.data, type);
  }
  if (Array.isArray(data.models)) {
    return normalizeFetchedModels(data.models, type);
  }
  if (Array.isArray(data)) {
    return normalizeFetchedModels(data, type);
  }
  return [];
}
