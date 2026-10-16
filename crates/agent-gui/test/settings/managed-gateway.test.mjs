import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const sync = loader.loadModule("@liveagent/ui/lib/settings/sync.ts");

test("legacy Gateway settings preserve external mode and explicit disabled state", () => {
  const remote = settings.normalizeRemoteSettings({
    enabled: false,
    gatewayUrl: "https://external.example.com",
    gatewayPort: 8443,
    token: "external-secret",
  });
  assert.equal(remote.enabled, false);
  assert.equal(remote.managedLocal, false);
  assert.equal(remote.localGatewayPort, 50052);
  assert.equal(remote.localGatewayToken, "");
  assert.equal(remote.gatewayUrl, "https://external.example.com");
  assert.equal(remote.token, "external-secret");
});

test("managed Gateway settings survive normalization and never enter sync or browser storage", () => {
  const app = settings.normalizeSettings({
    remote: {
      enabled: true,
      managedLocal: true,
      localGatewayPort: 59123,
      localGatewayToken: " local-secret ",
      gatewayUrl: "https://external.example.com",
      gatewayPort: 8443,
      token: " external-secret ",
    },
  });
  assert.equal(app.remote.managedLocal, true);
  assert.equal(app.remote.localGatewayPort, 59123);
  assert.equal(app.remote.localGatewayToken, "local-secret");
  assert.equal(app.remote.gatewayUrl, "https://external.example.com");
  assert.equal(app.remote.token, "external-secret");
  const stored = sync.redactSettingsForWebStorage(app);
  assert.equal(stored.remote.localGatewayToken, "");
  // WebUI also uses this helper for active state; its current login token must
  // remain available there. The WebUI persistence boundary strips it separately.
  assert.equal(stored.remote.token, "external-secret");
  const payload = sync.buildGatewaySettingsSyncPayload(app);
  assert.equal(Object.hasOwn(payload.remote, "managedLocal"), false);
  assert.equal(Object.hasOwn(payload.remote, "localGatewayToken"), false);
  assert.equal(Object.hasOwn(payload.remote, "token"), false);
});

test("desktop hosting toggle preserves external credentials and explicit off; browser hides it", async () => {
  let env;
  const Box = ({ children }) => env.React.createElement("div", null, children);
  const icons = Object.fromEntries(
    "Eye EyeOff GitBranch Globe Key Link2 MonitorSmartphone Radio RefreshCw Server Share2 Terminal Wifi WifiOff"
      .split(" ").map((name) => [name, () => null]),
  );
  const calls = [];
  env = await createDomTestEnv({ mocks: {
    "@liveagent/ui/components/IconSet": icons,
    "@liveagent/ui/i18n/index": { useLocale: () => ({ t: (key) => key }) },
    "@liveagent/app/shims/tauriCore": { invoke: async (name, args) => {
      calls.push([name, args]);
      if (name === "gateway_status") return { online: false, lastError: "port occupied" };
      return true;
    } },
    "@liveagent/app/shims/tauriEvent": { listen: async () => () => {} },
    "@liveagent/ui/components/settings/SettingsCopyButton": { SettingsCopyButton: () => null },
    "@liveagent/ui/components/settings/SettingsLayout": {
      SettingsSection: Box,
      SettingsRow: ({ title, description, control }) => env.React.createElement("section", null,
        env.React.createElement("p", null, title), description, control),
    },
    "@liveagent/ui/components/ui/dialog": {
      Dialog: ({ open, children }) => open ? env.React.createElement("div", null, children) : null,
      ...Object.fromEntries("DialogBody DialogContent DialogDescription DialogFooter DialogHeader DialogTitle"
        .split(" ").map((name) => [name, Box])),
    },
    "@liveagent/ui/components/ui/button": { Button: ({ children, size, variant, ...props }) =>
      env.React.createElement("button", props, children) },
    "@liveagent/ui/pages/settings/shared": { AgentActivationSwitch: ({ checked, title, onToggle }) =>
      env.React.createElement("button", { role: "switch", "aria-checked": checked, "aria-label": title, onClick: onToggle }) },
  } });
  const { React, act, createRoot } = env;
  const { RemoteSection } = env.loadModule("@liveagent/ui/pages/settings/RemoteSection.tsx");
  let app = settings.normalizeSettings({ remote: {
    enabled: false, gatewayUrl: "https://saved.example.com", gatewayPort: 8443, token: "keep-external",
    localGatewayPort: 59123, localGatewayToken: "local-secret",
  } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (showLocalGateway = true) => root.render(React.createElement(RemoteSection, {
    settings: app, surface: showLocalGateway ? "desktop" : "web", setSettings: (update) => { app = update(app); render(showLocalGateway); },
  }));
  try {
    await act(async () => render());
    await act(async () => host.querySelector('[aria-label="settings.remoteManagedLocal"]').click());
    assert.equal(app.remote.managedLocal, true);
    assert.equal(app.remote.enabled, false);
    assert.equal(app.remote.gatewayUrl, "https://saved.example.com");
    assert.equal(app.remote.gatewayPort, 8443);
    assert.equal(app.remote.token, "keep-external");
    assert.ok(host.textContent.includes("http://127.0.0.1:59123"));
    await act(async () => host.querySelector('[aria-label="settings.remoteEnable"]').click());
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("settings.remoteRetry"));
    assert.ok(retry);
    await act(async () => retry.click());
    assert.deepEqual(calls.at(-1), ["gateway_nudge_connection", { reason: "settings_retry", force_reconnect: true }]);
    assert.ok(host.textContent.includes("port occupied"));
    await act(async () => host.querySelector('[aria-label="settings.remoteManagedLocal"]').click());
    assert.equal(app.remote.managedLocal, false);
    assert.equal(app.remote.token, "keep-external");
    assert.ok(host.textContent.includes("https://saved.example.com:8443"));
    await act(async () => render(false));
    assert.equal(host.querySelector('[aria-label="settings.remoteManagedLocal"]'), null);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    env.cleanup();
  }
});
