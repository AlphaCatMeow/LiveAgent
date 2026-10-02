import { resolveProviderApi } from "@liveagent/ui/lib/providers/providerCapabilities";
import {
  type AppSettings,
  type CustomProvider,
  normalizeCustomProvider,
  type ProviderId,
} from "../settings";
import { createKBrainClient } from "./client";
import { getKBrainRuntimeConnection } from "./runtimeConnection";
import type { KBrainSettingsDocument, KBrainSettingsProvider, KBrainSettingsUpdate } from "./types";

export const KBRAIN_SETTINGS_CHANGED_EVENT = "kbrain:settings-changed";

function providerType(provider: KBrainSettingsProvider): ProviderId {
  if (["codex", "claude_code", "gemini", "xai", "deepseek"].includes(String(provider.type))) {
    return provider.type as ProviderId;
  }
  switch (provider.api) {
    case "anthropic-messages":
      return "claude_code";
    case "google-generative-ai":
      return "gemini";
    default:
      return "codex";
  }
}

export function customProviderFromKBrain(provider: KBrainSettingsProvider): CustomProvider {
  const models = provider.models.map((model) => ({
    ...model,
    displayName: model.displayName ?? model.name,
    maxOutputToken: model.maxOutputToken ?? model.maxOutputTokens,
    inputModalities:
      model.inputModalities ?? (model.vision === true ? ["text", "image"] : undefined),
    limitsSource: model.limitsSource ?? "provider",
  }));
  return normalizeCustomProvider({
    ...provider,
    type: providerType(provider),
    name: provider.name || provider.id,
    requestFormat:
      provider.requestFormat ??
      (provider.api === "openai-completions" ? "openai-completions" : undefined),
    apiKey: "",
    apiKeyConfigured: provider.apiKeyConfigured === true,
    models,
    activeModels: provider.activeModels ?? models.map((model) => model.id),
    usageQuery: {
      ...provider.usageQuery,
      apiKey: "",
      accessToken: "",
      secretAccessKey: "",
    },
  });
}

export function appProvidersFromKBrain(document: KBrainSettingsDocument): CustomProvider[] {
  if (!document || !Array.isArray(document.providers)) {
    throw new Error("Malformed K-brain provider settings response");
  }
  return document.providers.map(customProviderFromKBrain);
}

function settingsUpdateFromProviders(
  previousProviders: readonly CustomProvider[],
  providersInput: readonly CustomProvider[],
  selectedModel?: AppSettings["selectedModel"],
): KBrainSettingsUpdate {
  const previousById = new Map(previousProviders.map((provider) => [provider.id, provider]));
  const providers = providersInput.map((provider) => {
    const { apiKey, apiKeyConfigured: _configured, ...metadata } = provider;
    const clearApiKey =
      !apiKey.trim() &&
      provider.apiKeyConfigured === false &&
      previousById.get(provider.id)?.apiKeyConfigured === true;
    return {
      ...metadata,
      api: resolveProviderApi(provider.type, provider.requestFormat),
      ...(clearApiKey ? { clearApiKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
  });
  const nextIds = new Set(providersInput.map((provider) => provider.id));
  return {
    defaultProvider: selectedModel?.customProviderId ?? "",
    defaultModel: selectedModel?.model ?? "",
    providers,
    deleteProviders: previousProviders
      .filter((provider) => !nextIds.has(provider.id))
      .map((provider) => provider.id),
  };
}

export function kBrainSettingsUpdateFromAppSettings(
  previous: AppSettings,
  next: AppSettings,
): KBrainSettingsUpdate {
  return settingsUpdateFromProviders(
    previous.customProviders,
    next.customProviders,
    next.selectedModel,
  );
}

/** Build a one-time import request without exposing legacy provider secrets to storage. */
export function kBrainSettingsUpdateFromLegacyProviders(
  previousProviders: readonly CustomProvider[],
  providers: readonly CustomProvider[],
  selectedModel?: AppSettings["selectedModel"],
): KBrainSettingsUpdate {
  return settingsUpdateFromProviders(previousProviders, providers, selectedModel);
}

/** Import only providers absent from the backend; existing backend records are untouched. */
export function kBrainSettingsUpdateFromMissingLegacyProviders(
  providers: readonly CustomProvider[],
  selectedModel?: AppSettings["selectedModel"],
): KBrainSettingsUpdate {
  const update = settingsUpdateFromProviders([], providers, selectedModel);
  delete update.deleteProviders;
  return update;
}

export function getKBrainSettingsClient() {
  const connection = getKBrainRuntimeConnection();
  if (!connection) throw new Error("K-brain backend connection is not ready");
  return createKBrainClient({ baseUrl: connection.baseUrl, token: connection.token });
}

export async function loadKBrainProviderSettings(): Promise<KBrainSettingsDocument> {
  const document = await getKBrainSettingsClient().getSettings();
  appProvidersFromKBrain(document);
  return document;
}

export async function saveKBrainProviderSettings(
  update: KBrainSettingsUpdate,
): Promise<KBrainSettingsDocument> {
  const document = await getKBrainSettingsClient().updateSettings(update);
  appProvidersFromKBrain(document);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(KBRAIN_SETTINGS_CHANGED_EVENT));
  }
  return document;
}
