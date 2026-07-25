import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";

export type ProviderUsageEntry = {
  label: string;
  value: string;
  unit?: string | null;
};

export type ProviderUsageResult = {
  entries: ProviderUsageEntry[];
  queriedAt?: number | null;
  error?: string | null;
  isStale: boolean;
};

export type ProviderUsageState = Record<string, ProviderUsageResult>;

type UsageQueryProvider = {
  id: string;
  usageQuery?: {
    enabled?: boolean;
    autoRefreshMinutes?: number;
  };
};

type SelectedModel = { customProviderId: string } | undefined;

type UsageStateAction = {
  providerId: string;
  result?: ProviderUsageResult | null;
  error?: string;
};

export async function queryProviderUsage(
  providerId: string,
  refresh: boolean,
): Promise<ProviderUsageResult | null> {
  return invoke<ProviderUsageResult>("provider_usage_query", { providerId, refresh });
}

export function reduceUsageState(
  state: ProviderUsageState,
  action: UsageStateAction,
): ProviderUsageState {
  if (action.result) {
    return { ...state, [action.providerId]: action.result };
  }
  if (!action.error) return state;

  const previous = state[action.providerId];
  return {
    ...state,
    [action.providerId]: {
      entries: previous?.entries ?? [],
      queriedAt: previous?.queriedAt ?? null,
      error: action.error,
      isStale: Boolean(previous),
    },
  };
}

export function getAutoRefreshProvider<T extends UsageQueryProvider>(
  providers: readonly T[],
  selectedModel: SelectedModel,
): T | null {
  if (!selectedModel) return null;
  const provider = providers.find((item) => item.id === selectedModel.customProviderId);
  const autoRefreshMinutes = provider?.usageQuery?.autoRefreshMinutes ?? 0;
  if (!provider?.usageQuery?.enabled || autoRefreshMinutes <= 0) return null;
  return provider;
}

export function useProviderUsage(
  providers: readonly UsageQueryProvider[],
  selectedModel: SelectedModel,
) {
  const [usageByProvider, setUsageByProvider] = useState<ProviderUsageState>({});
  const [refreshingProviderIds, setRefreshingProviderIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const autoRefreshProvider = useMemo(
    () => getAutoRefreshProvider(providers, selectedModel),
    [providers, selectedModel],
  );

  const refreshProvider = useCallback(async (providerId: string, refresh = true) => {
    setRefreshingProviderIds((current) => new Set(current).add(providerId));
    try {
      const result = await queryProviderUsage(providerId, refresh);
      if (result) {
        setUsageByProvider((current) => reduceUsageState(current, { providerId, result }));
      }
    } catch {
      setUsageByProvider((current) =>
        reduceUsageState(current, { providerId, error: "Usage query failed" }),
      );
    } finally {
      setRefreshingProviderIds((current) => {
        const next = new Set(current);
        next.delete(providerId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!autoRefreshProvider) return;

    const autoRefreshMinutes = autoRefreshProvider.usageQuery?.autoRefreshMinutes ?? 0;
    if (autoRefreshMinutes <= 0) return;

    void refreshProvider(autoRefreshProvider.id, false);
    const interval = window.setInterval(
      () => void refreshProvider(autoRefreshProvider.id),
      autoRefreshMinutes * 60_000,
    );
    return () => window.clearInterval(interval);
  }, [autoRefreshProvider, refreshProvider]);

  return { usageByProvider, refreshingProviderIds, refreshProvider };
}
