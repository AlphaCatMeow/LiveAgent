import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const invokeCalls = [];
const loader = createTsModuleLoader({
  mocks: {
    "@tauri-apps/api/core": {
      invoke(command, args) {
        invokeCalls.push({ command, args });
        return Promise.resolve({
          entries: [{ label: "USD", value: "4.20" }],
          queriedAt: 123,
          error: null,
          isStale: false,
        });
      },
    },
  },
});
const usage = loader.loadModule("src/lib/providers/usageQuery.ts");

test("failed refresh retains prior values and marks result stale", () => {
  const state = usage.reduceUsageState(
    {},
    {
      providerId: "p",
      result: {
        entries: [{ label: "USD", value: "4.20" }],
        queriedAt: 123,
        error: null,
        isStale: false,
      },
    },
  );
  const next = usage.reduceUsageState(state, { providerId: "p", error: "timeout" });

  assert.equal(next.p.entries[0].value, "4.20");
  assert.equal(next.p.error, "timeout");
  assert.equal(next.p.isStale, true);
});

test("failed refresh does not mark an earlier failed placeholder as stale", () => {
  const state = {
    p: { entries: [], queriedAt: null, error: "offline", isStale: false },
  };
  const next = usage.reduceUsageState(state, { providerId: "p", error: "timeout" });

  assert.equal(next.p.isStale, false);
});

test("manual refresh queries only the requested provider", async () => {
  invokeCalls.length = 0;

  await usage.queryProviderUsage("provider-a", true);

  assert.deepEqual(invokeCalls, [
    {
      command: "provider_usage_query",
      args: { providerId: "provider-a", refresh: true },
    },
  ]);
});

test("auto refresh selects only the active provider with usage query enabled", () => {
  const providers = [
    { id: "provider-a", usageQuery: { enabled: true } },
    { id: "provider-b", usageQuery: { enabled: false } },
  ];

  assert.deepEqual(
    usage.getAutoRefreshProvider(providers, { customProviderId: "provider-a", model: "a" }),
    providers[0],
  );
  assert.equal(
    usage.getAutoRefreshProvider(providers, { customProviderId: "provider-b", model: "b" }),
    null,
  );
  assert.equal(usage.getAutoRefreshProvider(providers, undefined), null);
});

test("refresh plan hydrates every enabled provider and schedules only the selected provider", () => {
  const providers = [
    { id: "other-enabled", usageQuery: { enabled: true } },
    { id: "selected", usageQuery: { enabled: true } },
    { id: "disabled", usageQuery: { enabled: false } },
  ];

  assert.deepEqual(
    usage.getUsageRefreshPlan(providers, { customProviderId: "selected", model: "m" }),
    {
      hydrateProviderIds: ["other-enabled", "selected"],
      timer: { providerId: "selected", intervalMs: 300_000 },
    },
  );
});

test("coordinator ignores an older overlapping response and keeps loading until the current request ends", async () => {
  const deferred = [];
  const coordinator = usage.createProviderUsageCoordinator(() => {
    const next = {};
    next.promise = new Promise((resolve) => {
      next.resolve = resolve;
    });
    deferred.push(next);
    return next.promise;
  });
  const provider = { id: "p", usageQuery: { enabled: true } };
  coordinator.syncProviders([provider]);

  const first = coordinator.request("p", false);
  const second = coordinator.request("p", true);
  assert.equal(coordinator.getSnapshot().refreshingProviderIds.has("p"), true);

  deferred[0].resolve({
    entries: [{ label: "USD", value: "old" }],
    queriedAt: 1,
    error: null,
    isStale: false,
  });
  await first;
  assert.equal(coordinator.getSnapshot().usageByProvider.p, undefined);
  assert.equal(coordinator.getSnapshot().refreshingProviderIds.has("p"), true);

  deferred[1].resolve({
    entries: [{ label: "USD", value: "new" }],
    queriedAt: 2,
    error: null,
    isStale: false,
  });
  await second;
  assert.equal(coordinator.getSnapshot().usageByProvider.p.entries[0].value, "new");
  assert.equal(coordinator.getSnapshot().refreshingProviderIds.has("p"), false);
});

test("timer cleanup does not invalidate a manual refresh for the same provider", async () => {
  let resolve;
  const coordinator = usage.createProviderUsageCoordinator(
    () =>
      new Promise((nextResolve) => {
        resolve = nextResolve;
      }),
  );
  const provider = { id: "p", usageQuery: { enabled: true } };
  coordinator.syncProviders([provider]);

  const manualRefresh = coordinator.request("p", true);
  coordinator.invalidateRequest("p", "timer");
  resolve({ entries: [{ label: "USD", value: "manual" }], isStale: false });
  await manualRefresh;

  assert.equal(coordinator.getSnapshot().usageByProvider.p.entries[0].value, "manual");
});

test("timer cleanup invalidates the timer request it owns", async () => {
  let resolve;
  const coordinator = usage.createProviderUsageCoordinator(
    () =>
      new Promise((nextResolve) => {
        resolve = nextResolve;
      }),
  );
  const provider = { id: "p", usageQuery: { enabled: true } };
  coordinator.syncProviders([provider]);

  const timerRefresh = coordinator.request("p", true, "timer");
  coordinator.invalidateRequest("p", "timer");
  resolve({ entries: [{ label: "USD", value: "timer" }], isStale: false });
  await timerRefresh;

  assert.equal(coordinator.getSnapshot().usageByProvider.p, undefined);
});

test("coordinator prunes deleted and replaced provider requests before they can write", async () => {
  const deferred = [];
  const coordinator = usage.createProviderUsageCoordinator(() => {
    const next = {};
    next.promise = new Promise((resolve) => {
      next.resolve = resolve;
    });
    deferred.push(next);
    return next.promise;
  });
  const original = { id: "p", usageQuery: { enabled: true } };
  const replacement = { id: "p", usageQuery: { enabled: true } };
  coordinator.syncProviders([original]);

  const oldRequest = coordinator.request("p", false);
  coordinator.syncProviders([replacement]);
  deferred[0].resolve({ entries: [{ label: "USD", value: "old" }], isStale: false });
  await oldRequest;
  assert.equal(coordinator.getSnapshot().usageByProvider.p, undefined);

  const replacementRequest = coordinator.request("p", true);
  coordinator.syncProviders([]);
  deferred[1].resolve({ entries: [{ label: "USD", value: "new" }], isStale: false });
  await replacementRequest;
  assert.equal(coordinator.getSnapshot().usageByProvider.p, undefined);
  assert.equal(coordinator.getSnapshot().refreshingProviderIds.has("p"), false);
});

test("provider card display exposes stale error time and an accessible refresh action", () => {
  const display = usage.getProviderUsageCardDisplay(
    { id: "p", usageQuery: { enabled: true } },
    {
      entries: [{ label: "USD", value: "4.20" }],
      queriedAt: 1_700_000_000_000,
      error: "timeout",
      isStale: true,
    },
    true,
  );

  assert.equal(display.show, true);
  assert.equal(display.isStale, true);
  assert.equal(display.error, "timeout");
  assert.ok(display.updatedAt);
  assert.deepEqual(display.refresh, { ariaLabel: "Refresh usage", disabled: true });
});
