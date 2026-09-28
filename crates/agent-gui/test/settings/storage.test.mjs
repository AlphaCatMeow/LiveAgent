import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const LOCAL_UI_SETTINGS_STORAGE_KEY = "liveagent.ui-settings.v1";

function createMemoryLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

async function withGlobal(name, value, task) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    value,
  });
  try {
    return await task();
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, name, previous);
    } else {
      delete globalThis[name];
    }
  }
}

test("legacy local storage treats a null locale as an invalid saved preference", async () => {
  const localStorage = createMemoryLocalStorage({
    [LOCAL_UI_SETTINGS_STORAGE_KEY]: JSON.stringify({ locale: null }),
  });

  await withGlobal("navigator", { languages: ["en-GB"], language: "en-GB" }, async () => {
    await withGlobal("localStorage", localStorage, async () => {
      const loader = createTsModuleLoader({
        mocks: {
          "@tauri-apps/api/core": {
            invoke: async () => ({}),
          },
        },
      });
      const storage = loader.loadModule("src/lib/settings/storage.ts");

      assert.equal((await storage.loadPersistedSettings()).locale, "zh-CN");
    });
  });
});

// retryErrorSettings is a local-only UI preference persisted in localStorage
// (not gateway-synced), so its read/write round-trip lives entirely in the
// local-ui settings path — no backend command is involved.

test("retryErrorSettings default to every Cloudflare preset when localStorage is empty", async () => {
  const localStorage = createMemoryLocalStorage();

  await withGlobal("navigator", { languages: ["en-US"], language: "en-US" }, async () => {
    await withGlobal("localStorage", localStorage, async () => {
      const loader = createTsModuleLoader({
        mocks: { "@tauri-apps/api/core": { invoke: async () => ({}) } },
      });
      const storage = loader.loadModule("src/lib/settings/storage.ts");

      const loaded = await storage.loadPersistedSettings();
      assert.deepEqual(
        [...loaded.retryErrorSettings.presetStatusCodes].sort((a, b) => a - b),
        [520, 521, 522, 523, 525, 526, 527],
      );
      assert.deepEqual(loaded.retryErrorSettings.customPatterns, []);
    });
  });
});

test("retryErrorSettings are read back from localStorage and normalized", async () => {
  const localStorage = createMemoryLocalStorage({
    [LOCAL_UI_SETTINGS_STORAGE_KEY]: JSON.stringify({
      retryErrorSettings: {
        // User disabled 520/521, kept 525; an unknown code (999) and a
        // duplicate must be dropped on read.
        presetStatusCodes: [525, 525, 999],
        customPatterns: ["SSL handshake failed", "  ssl handshake failed  ", ""],
      },
    }),
  });

  await withGlobal("navigator", { languages: ["en-US"], language: "en-US" }, async () => {
    await withGlobal("localStorage", localStorage, async () => {
      const loader = createTsModuleLoader({
        mocks: { "@tauri-apps/api/core": { invoke: async () => ({}) } },
      });
      const storage = loader.loadModule("src/lib/settings/storage.ts");

      const loaded = await storage.loadPersistedSettings();
      assert.deepEqual(loaded.retryErrorSettings.presetStatusCodes, [525]);
      // Case-insensitive de-dup + trim + empty-drop.
      assert.deepEqual(loaded.retryErrorSettings.customPatterns, ["SSL handshake failed"]);
    });
  });
});

test("a missing retryErrorSettings field falls back to all presets (legacy snapshot)", async () => {
  // A pre-feature localStorage blob has no retryErrorSettings key; it must
  // normalize to the all-presets-on default, not an empty config.
  const localStorage = createMemoryLocalStorage({
    [LOCAL_UI_SETTINGS_STORAGE_KEY]: JSON.stringify({ theme: "dark" }),
  });

  await withGlobal("navigator", { languages: ["en-US"], language: "en-US" }, async () => {
    await withGlobal("localStorage", localStorage, async () => {
      const loader = createTsModuleLoader({
        mocks: { "@tauri-apps/api/core": { invoke: async () => ({}) } },
      });
      const storage = loader.loadModule("src/lib/settings/storage.ts");

      const loaded = await storage.loadPersistedSettings();
      assert.deepEqual(
        [...loaded.retryErrorSettings.presetStatusCodes].sort((a, b) => a - b),
        [520, 521, 522, 523, 525, 526, 527],
      );
    });
  });
});


test("sidebar shortcuts survive a local save and reload without changing resource activation", async () => {
  await withGlobal("localStorage", createMemoryLocalStorage(), async () => {
    const commands = [];
    const loader = createTsModuleLoader({
      mocks: { "@tauri-apps/api/core": { invoke: async (command) => {
        commands.push(command);
        return {};
      } } },
    });
    const storage = loader.loadModule("src/lib/settings/storage.ts");
    const settings = loader.loadModule("src/lib/settings/index.ts");
    const initial = await storage.loadPersistedSettings();
    assert.deepEqual(initial.customSettings.sidebarShortcuts, {
      skills: true, mcp: true, cron: true, memory: true,
    });
    const hidden = { skills: false, mcp: true, cron: false, memory: false };
    const next = settings.updateCustomSettings(initial, { sidebarShortcuts: hidden });
    commands.length = 0;
    await storage.persistSettings(initial, next);
    assert.deepEqual(commands, []);
    const loaded = await storage.loadPersistedSettings();
    assert.deepEqual(loaded.customSettings.sidebarShortcuts, hidden);
    for (const key of ["skills", "mcp", "memory"]) {
      assert.deepEqual(loaded[key], initial[key]);
    }
  });
});


const BROWSER_SETTINGS_STORAGE_KEY = "liveagent.kbrain-browser-settings.v1";
const HOST_MODULE = new URL("../../src/lib/host.ts", import.meta.url).pathname;

function loadBrowserStorage(invoke = () => assert.fail("browser settings must not invoke native commands")) {
  return createTsModuleLoader({ mocks: {
    [HOST_MODULE]: { isKBrainBrowserHost: () => true },
    "@liveagent/app/shims/tauriCore": { invoke },
  } });
}

function credentialSnapshot(prefix) {
  const secret = field => `${prefix}-${field}-secret`;
  return {
    providers: [{ id: "old", type: "codex", apiKey: secret("key"), headers: { Authorization: secret("header") },
      usageQuery: { apiKey: secret("usage"), headers: { Authorization: secret("usage-header") } } }],
    customProviders: [{ apiKey: secret("custom-key") }],
    backend: { token: secret("backend") },
    remote: { token: secret("remote") },
    stt: { providers: { tencent_cloud: { apiKey: secret("stt"), secretKey: secret("stt-key") } } },
    ssh: { hosts: [{ password: secret("ssh"), privateKey: secret("ssh-key") }] },
    mcp: { servers: [{ env: { API_KEY: secret("mcp-env") }, headers: { Authorization: secret("mcp-header") } }] },
    agents: [{ prompt: secret("agent-prompt") }],
    memory: { token: secret("memory") },
    modelFailover: { token: secret("failover") },
    system: { executionMode: "tools", workdir: "/repo/browser", systemProxy: { password: secret("proxy") },
      workspaceResourceSettings: { "/repo": { projectPrompt: secret("project-prompt") } } },
    customSettings: { promptClarifyEnabled: false, composerContextDisplay: "both",
      rightDock: { width: 480, projects: { "/repo": { tools: { tunnel: { uiState: { token: secret("dock") } } } } } },
      chatSidebar: { recentCollapsed: true, token: secret("sidebar") },
      headers: { Authorization: secret("custom-header") }, usageQuery: { apiKey: secret("custom-usage") } },
    chatRuntimeControls: { thinkingEnabled: false, reasoning: "off", reasoningByModel: { [secret("model")]: "high" }, token: secret("controls") },
    theme: "dark", locale: "en-US",
  };
}

function assertBrowserWhitelist(localStorage, marker) {
  const raw = localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY);
  assert.ok(raw);
  assert.ok(!raw.includes(marker), "credentials and runtime prompt text must be removed from the stored JSON");
  const saved = JSON.parse(raw);
  assert.deepEqual(Object.keys(saved).sort(), ["chatRuntimeControls", "customSettings", "locale", "system", "theme"]);
  assert.deepEqual(Object.keys(saved.system).sort(), ["executionMode", "workdir"]);
  assert.deepEqual(saved.customSettings.rightDock.projects, {});
  assert.doesNotMatch(raw, /"(?:apiKey|headers|usageQuery|password|token|providers|customProviders|agents|remote|stt|ssh)"/);
  return saved;
}

test("K-brain browser load migrates credential-bearing snapshots before returning settings", async () => {
  const nativeUi = JSON.stringify({ theme: "light", locale: "zh-CN", skills: { selected: ["native-skill"] },
    retryErrorSettings: { customPatterns: ["native preference"] }, selectedModel: { customProviderId: "native", model: "native-model" } });
  const localStorage = createMemoryLocalStorage({
    [BROWSER_SETTINGS_STORAGE_KEY]: JSON.stringify(credentialSnapshot("legacy")),
    [LOCAL_UI_SETTINGS_STORAGE_KEY]: nativeUi,
  });
  await withGlobal("localStorage", localStorage, async () => {
    const loader = loadBrowserStorage();
    const storage = loader.loadModule("src/lib/settings/storage.ts");
    const loaded = await storage.loadPersistedSettings();
    const saved = assertBrowserWhitelist(localStorage, "legacy-");
    assert.equal(loaded.theme, "dark");
    assert.equal(loaded.locale, "en-US");
    assert.equal(loaded.system.executionMode, "tools");
    assert.equal(loaded.system.workdir, "/repo/browser");
    assert.equal(loaded.customSettings.promptClarifyEnabled, false);
    assert.equal(loaded.customSettings.chatSidebar.recentCollapsed, true);
    assert.deepEqual(loaded.customProviders, []);
    assert.deepEqual(loaded.agents, []);
    assert.deepEqual(loaded.mcp.servers, []);
    assert.deepEqual(loaded.ssh.hosts, []);
    assert.equal(loaded.remote.token, "");
    assert.equal(loaded.system.systemProxy.password, "");
    assert.ok(!JSON.stringify(loaded).includes("legacy-"));
    assert.equal(localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY), nativeUi, "direct/native UI settings are not migrated in place");
    await storage.loadPersistedSettings();
    assert.deepEqual(JSON.parse(localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY)), saved, "migration is idempotent");
  });
});

test("K-brain browser persist never writes new credentials or whole runtime objects", async () => {
  const nativeUi = JSON.stringify({ theme: "light", locale: "zh-CN" });
  const localStorage = createMemoryLocalStorage({ [LOCAL_UI_SETTINGS_STORAGE_KEY]: nativeUi });
  const writes = [];
  const setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => { writes.push({ key, value }); setItem(key, value); };
  await withGlobal("localStorage", localStorage, async () => {
    const loader = loadBrowserStorage();
    const storage = loader.loadModule("src/lib/settings/storage.ts");
    const prev = await storage.loadPersistedSettings();
    assert.equal(prev.theme, "light", "safe legacy UI preferences migrate to the browser key");
    const next = { ...prev, ...credentialSnapshot("new"), customProviders: credentialSnapshot("new").providers };
    writes.length = 0;
    await storage.persistSettings(prev, next);
    const saved = assertBrowserWhitelist(localStorage, "new-");
    assert.equal(saved.theme, "dark");
    assert.equal(saved.system.workdir, "/repo/browser");
    assert.equal(saved.chatRuntimeControls.thinkingEnabled, false);
    assert.deepEqual(writes.map(write => write.key), [BROWSER_SETTINGS_STORAGE_KEY]);
    assert.ok(writes.every(write => !write.value.includes("new-")));
    assert.equal(localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY), nativeUi);
    assert.deepEqual((await storage.loadPersistedSettings()).customProviders, []);
  });
});

test("direct/native settings still load and save provider credentials through native storage", async () => {
  const browserSnapshot = JSON.stringify(credentialSnapshot("unrelated-browser"));
  const localStorage = createMemoryLocalStorage({ [BROWSER_SETTINGS_STORAGE_KEY]: browserSnapshot });
  const commands = [];
  await withGlobal("localStorage", localStorage, async () => {
    const loader = createTsModuleLoader({ mocks: {
      [HOST_MODULE]: { isKBrainBrowserHost: () => false },
      "@liveagent/app/shims/tauriCore": { invoke: async (command, args) => {
        commands.push({ command, args });
        return command === "settings_load_all" ? { providers: [{ id: "native", name: "Native", type: "codex", apiKey: "native-key", models: [], activeModels: [] }] } : undefined;
      } },
    } });
    const storage = loader.loadModule("src/lib/settings/storage.ts");
    const loaded = await storage.loadPersistedSettings();
    assert.equal(loaded.customProviders[0].apiKey, "native-key");
    const next = { ...loaded, customProviders: loaded.customProviders.map(provider => ({ ...provider, apiKey: "native-updated-key" })) };
    await storage.persistSettings(loaded, next);
    const save = commands.find(call => call.command === "settings_save_providers");
    assert.equal(save.args.payload[0].apiKey, "native-updated-key");
    assert.deepEqual(commands.map(call => call.command), ["settings_load_all", "settings_save_providers"]);
    assert.equal(localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY), browserSnapshot, "native mode must not modify browser settings");
    assert.equal(localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY), null);
  });
});

for (const operation of ["load", "save"]) {
  test(`K-brain browser ${operation} reports storage failures instead of claiming success`, async () => {
    const localStorage = createMemoryLocalStorage({ [BROWSER_SETTINGS_STORAGE_KEY]: JSON.stringify(credentialSnapshot("blocked")) });
    localStorage.setItem = () => { throw new Error("storage denied"); };
    await withGlobal("localStorage", localStorage, async () => {
      const loader = loadBrowserStorage();
      const storage = loader.loadModule("src/lib/settings/storage.ts");
      const settings = loader.loadModule("src/lib/settings/index.ts").getDefaultSettings();
      await assert.rejects(operation === "load" ? storage.loadPersistedSettings() : storage.persistSettings(settings, settings),
        error => error.code === (operation === "load" ? "load_failed" : "save_failed") && error.message.includes("storage denied"));
    });
  });
}


for (const raw of ['{"apiKey":"corrupt-key-secret",', 'null', '[{"headers":{"Authorization":"corrupt-key-secret"}}]']) {
  test(`K-brain browser load replaces invalid cache shape: ${raw}`, async () => {
    const nativeUi = JSON.stringify({ theme: "dark", locale: "en-US" });
    const localStorage = createMemoryLocalStorage({
      [BROWSER_SETTINGS_STORAGE_KEY]: raw,
      [LOCAL_UI_SETTINGS_STORAGE_KEY]: nativeUi,
    });
    await withGlobal("localStorage", localStorage, async () => {
      const storage = loadBrowserStorage().loadModule("src/lib/settings/storage.ts");
      const loaded = await storage.loadPersistedSettings();
      assert.equal(loaded.theme, "dark");
      assert.equal(loaded.locale, "en-US");
      assert.deepEqual(loaded.customProviders, []);
      assertBrowserWhitelist(localStorage, "corrupt-key-secret");
      assert.equal(localStorage.getItem(LOCAL_UI_SETTINGS_STORAGE_KEY), nativeUi);
    });
  });
}
