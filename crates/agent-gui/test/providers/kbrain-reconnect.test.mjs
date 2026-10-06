import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const old = { baseUrl: "http://old.test", token: "old", protocolVersion: "kbrain.agent.v1" };
const fresh = { ...old, baseUrl: "http://new.test", token: "new" };

function setup(t, fetch, desktop = true) {
  let connections = 0;
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { invoke: async () => { connections++; return fresh; } },
    [new URL("../../src/lib/host.ts", import.meta.url).pathname]: { isTauriHost: () => desktop },
  } });
  t.mock.method(globalThis, "fetch", fetch);
  const runtime = loader.loadModule("src/lib/kbrain/runtimeConnection.ts");
  runtime.setKBrainRuntimeConnection(old);
  return {
    runtime,
    connections: () => connections,
    transport: loader.loadModule("src/lib/kbrain/transport.ts"),
    client: loader.loadModule("src/lib/kbrain/client.ts").createKBrainClient(),
    planning: loader.loadModule("src/lib/planning/kbrain.ts"),
    cron: loader.loadModule("src/lib/automation/kbrainCron.ts"),
  };
}

test("concurrent stale desktop reads reconnect once and existing clients use new credentials", async (t) => {
  const calls = [];
  const app = setup(t, async (url, init) => {
    calls.push({ url, token: new Headers(init.headers).get("Authorization") });
    if (url.startsWith(old.baseUrl)) throw new TypeError("Load failed");
    return Response.json({ models: [] });
  });
  await Promise.all([app.client.listModels(), app.planning.requestPlanning("query"), app.cron.fetchKBrainCron()]);
  assert.equal(app.connections(), 1);
  assert.equal(calls.filter(c => c.url.startsWith(fresh.baseUrl)).length, 3);
  assert.ok(calls.filter(c => c.url.startsWith(fresh.baseUrl)).every(c => c.token === "Bearer new"));
  await app.client.listModels();
  assert.equal(calls.at(-1).url, fresh.baseUrl + "/v1/models");
});

test("failed mutation refreshes the connection without automatically replaying the write", async (t) => {
  let calls = 0;
  const app = setup(t, async () => { calls++; throw new TypeError("Load failed"); });
  await assert.rejects(app.planning.requestPlanning("mutate", { action: "todo.create" }), /Load failed/);
  assert.equal(calls, 1);
  assert.equal(app.connections(), 1);
  assert.equal(app.runtime.getConfiguredKBrainConnection().baseUrl, fresh.baseUrl);
});

test("expired token reconnects reads, while HTTP business errors do not reconnect", async (t) => {
  const app = setup(t, async url => url.startsWith(old.baseUrl)
    ? new Response("expired", { status: 401 }) : Response.json({ models: [] }));
  await app.client.listModels();
  assert.equal(app.connections(), 1);
  t.mock.method(globalThis, "fetch", async () => new Response("conflict", { status: 409 }));
  await assert.rejects(app.client.listModels(), /conflict/);
  assert.equal(app.connections(), 1);
});

test("explicit endpoints, browser requests and cancellation never start a desktop reconnect", async (t) => {
  const app = setup(t, async () => { throw new TypeError("Load failed"); });
  await assert.rejects(app.transport.fetchKBrain("/v1/models", {}, { baseUrl: "https://remote.test" }), /Load failed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(app.transport.fetchKBrain("/v1/models", { signal: controller.signal }));
  assert.equal(app.connections(), 0);
});

test("browser errors stay on their configured endpoint", async (t) => {
  const app = setup(t, async () => { throw new TypeError("Load failed"); }, false);
  await assert.rejects(app.client.listModels(), /Load failed/);
  assert.equal(app.connections(), 0);
});

test("a second transport failure is returned without an infinite retry", async (t) => {
  let calls = 0;
  const app = setup(t, async () => { calls++; throw new TypeError("Load failed"); });
  await assert.rejects(app.client.listModels(), /Load failed/);
  assert.equal(calls, 2);
  assert.equal(app.connections(), 1);
});
