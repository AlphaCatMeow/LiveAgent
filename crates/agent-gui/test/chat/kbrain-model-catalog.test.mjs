import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { createDomTestEnv } from "../helpers/dom-test-env.mjs";

const historyWrites = [];
const env = await createDomTestEnv({
  mocks: {
    "../../../lib/chat/history/chatHistory": {
      async setChatHistoryModel(id, selectedModelJson) {
        historyWrites.push({ id, selectedModelJson });
        return { id, selectedModelJson };
      },
    },
  },
});
after(() => env.cleanup());
const { React, act, createRoot, loadModule } = env;
const { normalizeSettings } = loadModule("src/lib/settings/index.ts");
const { projectKBrainProviders, projectKBrainSettings, useKBrainCatalogSettings } = loadModule("src/lib/kbrain/catalog.ts");
const { useChatModelSelection } = loadModule("src/pages/chat/runtime/useChatModelSelection.ts");
const { resolveEffectiveChatModelSelection } = loadModule("src/pages/chat/runtime/modelSelection.ts");

function loadWithBackendEnv(path) {
  const url = new URL(`../../${path}`, import.meta.url);
  const code = transformSync(readFileSync(url, "utf8"), {
    loader: "ts", format: "cjs", platform: "node",
    define: { "import.meta.env": JSON.stringify({ VITE_KBRAIN_BACKEND: "true", VITE_KBRAIN_URL: "http://kbrain.test/", VITE_KBRAIN_TOKEN: "backend-token" }) },
  }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(specifier => loadModule(specifier, fileURLToPath(new URL(".", url))), module, module.exports);
  return module.exports;
}
const backendCatalog = loadWithBackendEnv("src/lib/kbrain/catalog.ts");
const backendSelection = loadWithBackendEnv("src/pages/chat/runtime/useChatModelSelection.ts");

function directSettings() {
  return normalizeSettings({
    customProviders: [{
      id: "local-provider", type: "codex", name: "Local", apiKey: "direct-secret",
      baseUrl: "https://direct.invalid/v1", models: ["local-model", "local-other"],
      activeModels: ["local-model", "local-other"],
    }],
    selectedModel: { customProviderId: "local-provider", model: "local-model" },
  });
}

async function mount(run) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const previousFetch = globalThis.fetch;
  try { await run(root); }
  finally {
    await act(async () => root.unmount());
    container.remove();
    globalThis.fetch = previousFetch;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const refs = [
  { provider: "backend-anthropic-account", model: "claude-test" },
  { provider: "backend-openai-account", model: "gpt-test" },
  { provider: "backend-anthropic-account", model: "claude-other" },
  { provider: "backend-anthropic-account", model: "claude-test" },
];

test("catalog projection keeps opaque backend IDs, deduplicates pairs and never carries direct credentials", () => {
  const direct = directSettings();
  const before = JSON.stringify(direct);
  const providers = projectKBrainProviders([...refs, { provider: "", model: "bad" }, null]);
  assert.deepEqual(providers.map(p => p.id), ["backend-anthropic-account", "backend-openai-account"]);
  assert.deepEqual(providers[0].activeModels, ["claude-test", "claude-other"]);
  assert.deepEqual(providers[0].models.map(m => m.id), providers[0].activeModels);
  for (const provider of providers) {
    assert.equal(provider.apiKey, "");
    assert.equal(provider.baseUrl, "");
    assert.equal(provider.customHeaders, undefined);
    assert.equal(provider.usageQuery.apiKey, "");
  }
  const projected = projectKBrainSettings(direct, providers);
  assert.equal(projected.customProviders, providers);
  assert.equal(projected.selectedModel, undefined);
  assert.equal(projected.system, direct.system);
  assert.equal(JSON.stringify(direct), before);
});

test("real catalog and selection hooks fetch /v1/models, share send's provider lookup and preserve direct settings", async () => {
  await mount(async root => {
    const request = deferred();
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return request.promise; };
    const direct = directSettings();
    const before = JSON.stringify(direct);
    let snapshot, writes = 0;
    const entryRef = { current: new Map([["conversation", { isSending: false }]]) };
    const idRef = { current: "conversation" };
    const rows = new Map();
    const sidebarStore = { peek: () => ({ id: "conversation", isPending: false }), upsertLocal() {} };
    function Page({ theme = direct.theme }) {
      const [selectedModel, setSelectedModel] = React.useState();
      const settings = React.useMemo(() => ({ ...direct, theme }), [theme]);
      const catalog = backendCatalog.useKBrainCatalogSettings(settings);
      const selection = backendSelection.useChatModelSelection({
        settings: catalog.settings,
        setSettings() { writes++; },
        t: key => key,
        sidebarStore,
        sidebarConversationsById: rows,
        currentConversationId: "conversation",
        currentConversationSelectedModel: selectedModel,
        currentConversationIdRef: idRef,
        conversationRuntimeCacheRef: entryRef,
        updateConversationRuntimeEntry: React.useCallback((id, updater) => {
          const next = updater(entryRef.current.get(id));
          entryRef.current.set(id, next);
          setSelectedModel(next.selectedModel);
          return next;
        }, []),
      });
      snapshot = { catalog, selection, selectedModel };
      return null;
    }
    await act(async () => root.render(React.createElement(Page)));
    assert.equal(snapshot.selection.hasModels, false, "pending catalog must not expose local providers");
    assert.equal(snapshot.selection.activeSelectedModel, undefined);
    await act(async () => request.resolve(new Response(JSON.stringify({ models: refs }), { status: 200 })));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://kbrain.test/v1/models");
    assert.equal(calls[0].init.headers.Authorization, "Bearer backend-token");
    assert.deepEqual(snapshot.selection.modelOptions.map(o => [o.providerId, o.model]), [
      ["backend-anthropic-account", "claude-test"],
      ["backend-anthropic-account", "claude-other"],
      ["backend-openai-account", "gpt-test"],
    ]);
    const selection = { customProviderId: "backend-anthropic-account", model: "claude-other" };
    await act(async () => snapshot.selection.handleSelectModel(selection));
    assert.deepEqual(snapshot.selection.activeSelectedModel, selection);
    assert.equal(snapshot.selection.currentModelLabel, "backend-anthropic-account / claude-other");
    const effective = resolveEffectiveChatModelSelection({
      settings: snapshot.catalog.settings, conversationSelectedModel: snapshot.selectedModel,
    });
    assert.equal(effective.provider, snapshot.catalog.settings.customProviders[0]);
    assert.equal(effective.provider.apiKey, "");
    assert.equal(effective.selectedModel.customProviderId, "backend-anthropic-account", "turn model.provider must use the backend ID");
    assert.deepEqual(JSON.parse(historyWrites.at(-1).selectedModelJson), selection);
    assert.equal(writes, 0);
    assert.equal(JSON.stringify(direct), before);
    const modelOptions = snapshot.selection.modelOptions;
    await act(async () => root.render(React.createElement(Page, { theme: "dark" })));
    assert.equal(snapshot.selection.modelOptions, modelOptions);
    assert.equal(calls.length, 1, "unrelated settings changes must not refetch the catalog");
    const restored = { customProviderId: "backend-openai-account", model: "gpt-test" };
    rows.set("conversation", { selectedModelJson: JSON.stringify(restored) });
    await act(async () => root.render(React.createElement(Page, { theme: "light" })));
    assert.deepEqual(snapshot.selection.activeSelectedModel, restored, "history-sync must validate against the same backend catalog");
    assert.equal(writes, 0);
    assert.equal(JSON.stringify(direct), before);
  });
});

test("catalog failure and empty responses never fall back to direct providers; late requests are ignored", async () => {
  await mount(async root => {
    const oldRequest = deferred();
    const direct = directSettings();
    let snapshot;
    globalThis.fetch = async url => {
      if (url.startsWith("http://old.test")) return oldRequest.promise;
      if (url.startsWith("http://failed.test")) return new Response("offline", { status: 503 });
      return new Response("[]", { status: 200 });
    };
    function Page({ baseUrl, enabled = true }) {
      snapshot = useKBrainCatalogSettings(direct, { enabled, baseUrl });
      return null;
    }
    await act(async () => root.render(React.createElement(Page, { baseUrl: "http://old.test" })));
    await act(async () => root.render(React.createElement(Page, { baseUrl: "http://failed.test" })));
    assert.match(snapshot.error, /offline/);
    assert.deepEqual(snapshot.settings.customProviders, []);
    await act(async () => oldRequest.resolve(new Response(JSON.stringify(refs))));
    assert.match(snapshot.error, /offline/);
    assert.deepEqual(snapshot.settings.customProviders, []);
    await act(async () => root.render(React.createElement(Page, { baseUrl: "http://empty.test" })));
    assert.equal(snapshot.error, null);
    assert.deepEqual(snapshot.settings.customProviders, []);
    await act(async () => root.render(React.createElement(Page, { enabled: false })));
    assert.equal(snapshot.settings, direct);
    assert.equal(snapshot.error, null);
  });
});

test("direct mode uses the real selection hook unchanged and does not fetch a catalog", async () => {
  await mount(async root => {
    let fetches = 0, snapshot, settings = directSettings();
    globalThis.fetch = async () => { fetches++; throw new Error("unexpected catalog fetch"); };
    const rows = new Map();
    function Page() {
      const catalog = useKBrainCatalogSettings(settings);
      snapshot = { catalog, selection: useChatModelSelection({
        settings: catalog.settings,
        setSettings: updater => { settings = updater(settings); },
        t: key => key,
        sidebarStore: { peek: () => undefined },
        sidebarConversationsById: rows,
        currentConversationId: "direct",
        currentConversationIdRef: { current: "direct" },
        conversationRuntimeCacheRef: { current: new Map() },
        updateConversationRuntimeEntry: (_id, updater) => updater({}),
      }) };
      return null;
    }
    await act(async () => root.render(React.createElement(Page)));
    assert.equal(snapshot.catalog.settings, settings);
    assert.equal(snapshot.selection.hasModels, true);
    assert.equal(snapshot.selection.activeSelectedModel.model, "local-model");
    await act(async () => snapshot.selection.handleSelectModel({ customProviderId: "local-provider", model: "local-other" }));
    assert.equal(settings.selectedModel.model, "local-other");
    assert.equal(settings.customProviders[0].apiKey, "direct-secret");
    assert.equal(fetches, 0);
  });
});

test("ChatPage projects once before model selection and send, without replacing its settings writer", () => {
  const source = readFileSync(new URL("../../src/pages/ChatPage.tsx", import.meta.url), "utf8");
  assert.match(source, /settings: directSettings,/);
  assert.match(source, /const \{ settings, error: modelCatalogError \} = useKBrainCatalogSettings\(directSettings\)/);
  assert.match(source, /useChatModelSelection\(\{\s*settings,\s*setSettings,/);
  assert.match(source, /useSendChatTurn\(\{\s*settings,/);
  assert.match(source, /errorMessage: errorMessage \?\? modelCatalogError/);
});
