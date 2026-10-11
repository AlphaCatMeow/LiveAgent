import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const HOST_MODULE = new URL("../../src/lib/host.ts", import.meta.url).pathname;

const provider = (models) => ({
  id: "p1",
  name: "Relay",
  type: "codex",
  baseUrl: "https://relay.invalid/v1",
  isFullUrl: false,
  apiKey: "",
  apiKeyConfigured: true,
  models,
  activeModels: models.map((m) => m.id),
  reasoning: "off",
  promptCachingEnabled: false,
});

// K-brain stand-in: rejects provider payloads with duplicate model ids (400), or fails with 503.
async function startKBrain() {
  let stored = [{ id: "p1", name: "Relay", type: "codex", apiKeyConfigured: true, models: [{ id: "a" }] }];
  let puts = 0;
  let outage = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const reply = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "PUT") {
      puts++;
      if (outage) return reply(503, { error: "backend restarting" });
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const ids = (body.providers?.[0]?.models ?? []).map((m) => m.id);
      if (new Set(ids).size !== ids.length) return reply(400, { error: "models require unique IDs" });
      stored = body.providers.map((p) => ({ id: p.id, name: p.name, type: p.type, apiKeyConfigured: true, models: p.models }));
    }
    reply(200, { version: "kbrain.agent.v1", mode: "kbrain", providers: stored });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    puts: () => puts,
    setOutage: (value) => {
      outage = value;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function setup() {
  const kbrain = await startKBrain();
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const loader = createTsModuleLoader({
    mocks: {
      [HOST_MODULE]: { isKBrainBrowserHost: () => true, isKBrainBackendEnabled: () => false, isTauriHost: () => false },
      "@tauri-apps/api/core": { invoke: async () => assert.fail("native storage must not be used") },
    },
  });
  const runtime = loader.loadModule("src/lib/kbrain/runtimeConnection.ts");
  runtime.setKBrainRuntimeConnection({ baseUrl: kbrain.baseUrl, token: "t", protocolVersion: "kbrain.agent.v1" });
  const storage = loader.loadModule("src/lib/settings/storage.ts");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const base = { ...getDefaultSettings(), customProviders: [provider([{ id: "a" }])] };
  return { kbrain, runtime, storage, base };
}

test("a rejected provider save reverts to K-brain's records and does not poison later saves", async () => {
  const { kbrain, runtime, storage, base } = await setup();
  try {
    const bad = { ...base, customProviders: [provider([{ id: "dup" }, { id: "dup" }])] };
    const rejected = await storage.persistSettings(base, bad);
    assert.ok(rejected.providerError, "the rejection is reported");
    assert.deepEqual(
      rejected.customProviders.map((p) => p.models.map((m) => m.id)),
      [["a"]],
      "the UI is handed K-brain's records, not the rejected edit",
    );

    // An unrelated save right after must not re-send the rejected providers.
    const putsBefore = kbrain.puts();
    const themeOnly = { ...bad, theme: bad.theme === "dark" ? "light" : "dark" };
    const later = await storage.persistSettings(bad, themeOnly);
    assert.equal(later.providerError, undefined);
    assert.equal(kbrain.puts(), putsBefore, "no provider request for a theme change");
  } finally {
    runtime.clearKBrainRuntimeConnection();
    await kbrain.close();
  }
});

test("a transient provider save failure is still retried on the next save", async () => {
  const { kbrain, runtime, storage, base } = await setup();
  try {
    const edited = { ...base, customProviders: [provider([{ id: "a" }, { id: "b" }])] };
    kbrain.setOutage(true);
    await assert.rejects(() => storage.persistSettings(base, edited));
    kbrain.setOutage(false);
    const putsBefore = kbrain.puts();
    const themeOnly = { ...edited, theme: edited.theme === "dark" ? "light" : "dark" };
    const retried = await storage.persistSettings(edited, themeOnly);
    assert.equal(kbrain.puts(), putsBefore + 1, "the failed provider change is retried");
    assert.deepEqual(
      retried.customProviders.map((p) => p.models.map((m) => m.id)),
      [["a", "b"]],
    );
  } finally {
    runtime.clearKBrainRuntimeConnection();
    await kbrain.close();
  }
});
