import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

const loader = createTsModuleLoader();
const { normalizeRemoteSettings } = loader.loadModule("src/lib/settings/index.ts");
const { buildFallbackGatewayStatus } = loader.loadModule("src/pages/chat/gateway/gatewayRuntimeStatusModel.ts");

test("fallback Gateway status resolves selected connection without assuming enabled means configured", () => {
  const local = normalizeRemoteSettings({ enabled: true, managedLocal: true, localGatewayPort: 59123, localGatewayToken: "local-token" });
  assert.equal(buildFallbackGatewayStatus(local).configured, true);
  assert.equal(buildFallbackGatewayStatus(local).gatewayUrl, "http://127.0.0.1:59123");
  assert.equal(buildFallbackGatewayStatus({ ...local, localGatewayToken: "" }).configured, false);
  assert.equal(buildFallbackGatewayStatus({ ...local, localGatewayPort: 0 }).configured, false);
  assert.equal(buildFallbackGatewayStatus({ ...local, localGatewayPort: 65536 }).configured, false);
  assert.equal(buildFallbackGatewayStatus({ ...local, enabled: false }).enabled, false);
  assert.equal(buildFallbackGatewayStatus({ ...local, managedLocal: false }).configured, false);
  const external = { ...local, managedLocal: false, gatewayUrl: "https://external.example.com", token: "external-token" };
  assert.equal(buildFallbackGatewayStatus(external).configured, true);
  assert.equal(buildFallbackGatewayStatus(external).gatewayUrl, external.gatewayUrl);
  assert.equal(buildFallbackGatewayStatus({ ...external, token: "" }).configured, false);
});

test("Gateway status fallback refreshes on local mode, port and credential changes", async () => {
  let requests = 0;
  let subscriptions = 0;
  let disposed = 0;
  const env = await createDomTestEnv({ mocks: {
    "@tauri-apps/api/core": { invoke: async () => { requests++; throw new Error("IPC unavailable"); } },
    "@tauri-apps/api/event": { listen: async () => { subscriptions++; return () => disposed++; } },
  } });
  const { React, act, createRoot } = env;
  const { useGatewayStatus } = env.loadModule("src/pages/chat/gateway/useGatewayStatus.ts");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const Probe = ({ remote }) => {
    const { remoteRuntimeStatus } = useGatewayStatus({ remote });
    return React.createElement("pre", null, JSON.stringify(remoteRuntimeStatus));
  };
  const render = async (remote) => {
    await act(async () => root.render(React.createElement(Probe, { remote })));
    return JSON.parse(host.textContent);
  };
  try {
    let remote = normalizeRemoteSettings({ enabled: true });
    assert.equal((await render(remote)).configured, false);
    remote = { ...remote, managedLocal: true, localGatewayPort: 59123, localGatewayToken: "local-token" };
    assert.equal((await render(remote)).gatewayUrl, "http://127.0.0.1:59123");
    remote = { ...remote, localGatewayPort: 59124 };
    assert.equal((await render(remote)).gatewayUrl, "http://127.0.0.1:59124");
    remote = { ...remote, localGatewayToken: "" };
    assert.equal((await render(remote)).configured, false);
    remote = { ...remote, managedLocal: false, gatewayUrl: "https://external.example.com", token: "external-token" };
    const external = await render(remote);
    assert.equal(external.gatewayUrl, remote.gatewayUrl);
    assert.equal(external.configured, true);
    assert.equal(requests, 5);
    assert.equal(subscriptions, 5);
    assert.equal(disposed, 4);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    env.cleanup();
  }
});
