import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGatewayWebSocketClient } from "@/lib/gatewaySocket";
import { loadToken } from "@/lib/storage";

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

type UsageSnapshot = {
  usageByProvider: ProviderUsageState;
  refreshingProviderIds: ReadonlySet<string>;
};

type UsageQuery = (providerId: string, refresh: boolean) => Promise<ProviderUsageResult | null>;

type UsageRequestSource = "timer" | "other";

export async function queryProviderUsage(
  providerId: string,
  refresh: boolean,
): Promise<ProviderUsageResult | null> {
  return getGatewayWebSocketClient(
    loadToken().trim(),
  ).providerUsageQuery<ProviderUsageResult | null>(providerId, refresh);
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
  const hasLastGoodValue = Boolean(previous?.entries.length || previous?.queriedAt);
  return {
    ...state,
    [action.providerId]: {
      entries: previous?.entries ?? [],
      queriedAt: previous?.queriedAt ?? null,
      error: action.error,
      isStale: hasLastGoodValue,
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

export function getUsageRefreshPlan<T extends UsageQueryProvider>(
  providers: readonly T[],
  selectedModel: SelectedModel,
) {
  const autoRefreshProvider = getAutoRefreshProvider(providers, selectedModel);
  return {
    hydrateProviderIds: providers
      .filter((provider) => provider.usageQuery?.enabled)
      .map((provider) => provider.id),
    timer: autoRefreshProvider
      ? {
          providerId: autoRefreshProvider.id,
          intervalMs: (autoRefreshProvider.usageQuery?.autoRefreshMinutes ?? 0) * 60_000,
        }
      : null,
  };
}

export function getProviderUsageCardDisplay(
  provider: UsageQueryProvider,
  usage: ProviderUsageResult | undefined,
  refreshing: boolean,
) {
  const queriedAt = usage?.queriedAt ?? null;
  const date = queriedAt ? new Date(queriedAt) : null;
  return {
    show: Boolean(provider.usageQuery?.enabled || usage),
    entries: usage?.entries ?? [],
    isStale: usage?.isStale === true,
    error: usage?.error ?? null,
    updatedAt: date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : null,
    refresh: { ariaLabel: "Refresh usage", disabled: refreshing },
  };
}

export function createProviderUsageCoordinator(query: UsageQuery) {
  let providers = new Map<string, UsageQueryProvider>();
  const generations = new Map<string, number>();
  const requestSources = new Map<string, UsageRequestSource>();
  let usageByProvider: ProviderUsageState = {};
  let refreshingProviderIds = new Set<string>();
  const listeners = new Set<(snapshot: UsageSnapshot) => void>();

  function snapshot(): UsageSnapshot {
    return { usageByProvider, refreshingProviderIds: new Set(refreshingProviderIds) };
  }

  function emit() {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  }

  function nextGeneration(providerId: string) {
    const next = (generations.get(providerId) ?? 0) + 1;
    generations.set(providerId, next);
    return next;
  }

  function isCurrent(providerId: string, provider: UsageQueryProvider, generation: number) {
    return providers.get(providerId) === provider && generations.get(providerId) === generation;
  }

  function invalidate(providerId: string, clearUsage: boolean) {
    nextGeneration(providerId);
    requestSources.delete(providerId);
    const nextRefreshing = new Set(refreshingProviderIds);
    nextRefreshing.delete(providerId);
    refreshingProviderIds = nextRefreshing;
    if (clearUsage && usageByProvider[providerId]) {
      const nextUsage = { ...usageByProvider };
      delete nextUsage[providerId];
      usageByProvider = nextUsage;
    }
  }

  return {
    getSnapshot: snapshot,
    subscribe(listener: (next: UsageSnapshot) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncProviders(nextProviders: readonly UsageQueryProvider[]) {
      const nextById = new Map(nextProviders.map((provider) => [provider.id, provider]));
      const ids = new Set([...providers.keys(), ...nextById.keys()]);
      let changed = false;
      for (const providerId of ids) {
        if (providers.get(providerId) === nextById.get(providerId)) continue;
        invalidate(providerId, true);
        changed = true;
      }
      providers = nextById;
      if (changed) emit();
    },
    invalidateRequest(providerId: string, source?: UsageRequestSource) {
      if (!providers.has(providerId) || (source && requestSources.get(providerId) !== source))
        return;
      invalidate(providerId, false);
      emit();
    },
    async request(providerId: string, refresh: boolean, source: UsageRequestSource = "other") {
      const provider = providers.get(providerId);
      if (!provider) return;

      const generation = nextGeneration(providerId);
      requestSources.set(providerId, source);
      refreshingProviderIds = new Set(refreshingProviderIds).add(providerId);
      emit();
      try {
        const result = await query(providerId, refresh);
        if (result && isCurrent(providerId, provider, generation)) {
          usageByProvider = reduceUsageState(usageByProvider, { providerId, result });
          emit();
        }
      } catch {
        if (isCurrent(providerId, provider, generation)) {
          usageByProvider = reduceUsageState(usageByProvider, {
            providerId,
            error: "Usage query failed",
          });
          emit();
        }
      } finally {
        if (isCurrent(providerId, provider, generation)) {
          requestSources.delete(providerId);
          refreshingProviderIds = new Set(refreshingProviderIds);
          refreshingProviderIds.delete(providerId);
          emit();
        }
      }
    },
  };
}

export function useProviderUsage(
  providers: readonly UsageQueryProvider[],
  selectedModel: SelectedModel,
) {
  const coordinatorRef = useRef<ReturnType<typeof createProviderUsageCoordinator> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createProviderUsageCoordinator(queryProviderUsage);
  }
  const coordinator = coordinatorRef.current;
  const [snapshot, setSnapshot] = useState(() => coordinator.getSnapshot());
  const refreshPlan = useMemo(
    () => getUsageRefreshPlan(providers, selectedModel),
    [providers, selectedModel],
  );

  useEffect(() => coordinator.subscribe(setSnapshot), [coordinator]);

  useEffect(() => {
    coordinator.syncProviders(providers);
  }, [coordinator, providers]);

  useEffect(() => {
    return () => coordinator.syncProviders([]);
  }, [coordinator]);

  useEffect(() => {
    for (const providerId of refreshPlan.hydrateProviderIds) {
      void coordinator.request(providerId, false);
    }
  }, [coordinator, refreshPlan.hydrateProviderIds]);

  useEffect(() => {
    if (!refreshPlan.timer) return;
    const { providerId, intervalMs } = refreshPlan.timer;
    const interval = window.setInterval(
      () => void coordinator.request(providerId, true, "timer"),
      intervalMs,
    );
    return () => {
      window.clearInterval(interval);
      coordinator.invalidateRequest(providerId, "timer");
    };
  }, [coordinator, refreshPlan.timer]);

  const refreshProvider = useCallback(
    (providerId: string) => coordinator.request(providerId, true),
    [coordinator],
  );

  return { ...snapshot, refreshProvider };
}
