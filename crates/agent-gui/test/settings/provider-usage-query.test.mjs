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

test("auto refresh selects only the active provider with an enabled interval", () => {
  const providers = [
    { id: "provider-a", usageQuery: { enabled: true, autoRefreshMinutes: 5 } },
    { id: "provider-b", usageQuery: { enabled: true, autoRefreshMinutes: 0 } },
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
