import { useEffect, useMemo, useState } from "react";
import {
  type AppSettings,
  type CustomProvider,
  createProviderModelConfig,
  getDefaultUsageQueryConfig,
} from "../settings";
import { createKBrainClient } from "./client";
import type { KBrainModelRef } from "./types";

export function projectKBrainProviders(models: readonly KBrainModelRef[]): CustomProvider[] {
  const providers = new Map<string, CustomProvider>();
  for (const entry of models) {
    if (
      typeof entry?.provider !== "string" ||
      !entry.provider.trim() ||
      typeof entry?.model !== "string" ||
      !entry.model.trim()
    )
      continue;
    let provider = providers.get(entry.provider);
    if (!provider) {
      provider = {
        id: entry.provider,
        name: entry.provider,
        // The catalog exposes opaque IDs, not vendor types. Routing uses id, never type.
        type: "codex",
        baseUrl: "",
        isFullUrl: false,
        apiKey: "",
        models: [],
        activeModels: [],
        reasoning: "off",
        promptCachingEnabled: false,
        nativeWebSearchEnabled: false,
        useSystemProxy: false,
        usageQuery: getDefaultUsageQueryConfig(),
      };
      providers.set(entry.provider, provider);
    }
    if (provider.activeModels.includes(entry.model)) continue;
    provider.models.push(createProviderModelConfig(provider.type, entry.model));
    provider.activeModels.push(entry.model);
  }
  return [...providers.values()];
}

export function projectKBrainSettings(
  settings: AppSettings,
  providers: CustomProvider[],
): AppSettings {
  return { ...settings, customProviders: providers, selectedModel: undefined };
}

type CatalogOptions = {
  enabled?: boolean;
  baseUrl?: string;
  token?: string;
};

export const KBRAIN_SETTINGS_CHANGED_EVENT = "kbrain:settings-changed";

export function useKBrainCatalogSettings(settings: AppSettings, options: CatalogOptions = {}) {
  const enabled = options.enabled ?? import.meta.env?.VITE_KBRAIN_BACKEND === "true";
  const [settingsVersion, setSettingsVersion] = useState(0);
  const baseUrl = options.baseUrl ?? import.meta.env?.VITE_KBRAIN_URL;
  const token = options.token ?? import.meta.env?.VITE_KBRAIN_TOKEN;
  const [catalog, setCatalog] = useState<{
    baseUrl: string | undefined;
    token: string | undefined;
    providers: CustomProvider[];
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onSettingsChanged = () => setSettingsVersion((version) => version + 1);
    window.addEventListener(KBRAIN_SETTINGS_CHANGED_EVENT, onSettingsChanged);
    return () => window.removeEventListener(KBRAIN_SETTINGS_CHANGED_EVENT, onSettingsChanged);
  }, [enabled]);
  useEffect(() => {
    const refreshKey = settingsVersion;
    if (!enabled || refreshKey < 0) return;
    let cancelled = false;
    setCatalog(null);
    void createKBrainClient({ baseUrl, token })
      .listModels()
      .then((models) => {
        if (!cancelled) {
          setCatalog({ baseUrl, token, providers: projectKBrainProviders(models), error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalog({
            baseUrl,
            token,
            providers: [],
            error: `K-brain 模型目录加载失败：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, baseUrl, token, settingsVersion]); // refresh after backend settings writes
  const currentCatalog = catalog?.baseUrl === baseUrl && catalog?.token === token ? catalog : null;
  const runtimeSettings = useMemo(
    () => (enabled ? projectKBrainSettings(settings, currentCatalog?.providers ?? []) : settings),
    [enabled, settings, currentCatalog],
  );
  return { settings: runtimeSettings, error: enabled ? (currentCatalog?.error ?? null) : null };
}
