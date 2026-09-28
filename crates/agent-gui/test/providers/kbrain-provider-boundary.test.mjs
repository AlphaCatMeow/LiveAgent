import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function loadBackendConfig(flag, baseUrl) {
  return loadEnvModule("src/lib/providers/runtime/providerRuntimeConfig.ts", flag, {}, baseUrl ? { VITE_KBRAIN_URL: baseUrl } : {});
}

function loadEnvModule(specifier, flag, mocks = {}, extraEnv = {}) {
  const loader = createTsModuleLoader({ mocks });
  const file = loader.resolveLocal(specifier);
  const source = readFileSync(file, "utf8");
  const { code } = transformSync(source, {
    loader: "ts",
    format: "cjs",
    define: {
      "import.meta.env": JSON.stringify({
        ...(flag === undefined ? {} : { VITE_KBRAIN_BACKEND: flag }),
        ...extraEnv,
      }),
    },
  });
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(module, exports, require) { ${code}\n})`);
  run(module, module.exports, (specifier) => loader.loadModule(specifier, path.dirname(file)));
  return module.exports;
}

async function withTextHttpFixture(callback) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ request, body: body ? JSON.parse(body) : undefined });
    if (request.url !== "/v1/text/generate") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unexpected path" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      version: "kbrain.agent.v1",
      text: "backend text",
      model: requests.at(-1).body.model,
      usage: { input_tokens: 2, output_tokens: 3 },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const parsed = new URL(String(url));
    return originalFetch(`${origin}${parsed.pathname}${parsed.search}`, init);
  };
  try {
    return await callback(origin, requests);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const provider = {
  id: "provider-1",
  name: "Provider",
  type: "codex",
  baseUrl: "https://upstream.test/v1?key=query-secret",
  isFullUrl: true,
  apiKey: "provider-secret",
  customHeaders: [{ key: "Authorization", value: "Bearer header-secret" }],
  requestFormat: "openai-responses",
  models: [],
  activeModels: ["gpt-5"],
};

for (const flag of [undefined, "false", "TRUE", "1", "true"]) {
  test(`runtime backend is opt-in and transport secrets are isolated (flag=${flag})`, () => {
    const config = loadBackendConfig(flag);
    const runtime = config.createProviderRuntimeConfig(provider, "gpt-5", undefined);
    const enabled = flag === "true";
    assert.equal(config.getProviderRuntimeBackend(), enabled ? "kbrain" : "direct");
    assert.equal(runtime.backend, enabled ? "kbrain" : "direct");
    assert.equal(runtime.baseUrl, enabled ? "" : provider.baseUrl);
    assert.equal(runtime.apiKey, enabled ? "" : provider.apiKey);
    assert.equal(runtime.isFullUrl, !enabled);
    assert.deepEqual(runtime.customHeaders, enabled ? undefined : provider.customHeaders);
    assert.ok(runtime.modelConfig);
    if (enabled) assert.doesNotMatch(JSON.stringify(runtime), /provider-secret|header-secret|query-secret/);
    assert.equal(provider.apiKey, "provider-secret");
  });
}

for (const flag of ["true", "false"]) {
  test(`SDK dispatch ${flag === "true" ? "blocks" : "preserves"} direct provider calls`, () => {
    let adapterCalls = 0;
    let resolutions = 0;
    const result = { result: async () => ({}) };
    const config = loadBackendConfig(flag);
    const root = createTsModuleLoader();
    const loader = createTsModuleLoader({
      mocks: {
        [root.resolveLocal("src/lib/providers/runtime/providerRuntimeConfig.ts")]: config,
        "../service/defaultAdapters": { ensureDefaultLlmAdapters() {} },
        "../service/registry": {
          resolveAdapter() {
            resolutions++;
            return { stream() { adapterCalls++; return result; } };
          },
        },
      },
    });
    const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
    const { llm } = loader.loadModule("src/lib/providers/service/llmService.ts");
    const model = { id: "gpt-5", api: "openai-responses", baseUrl: provider.baseUrl };
    const context = { messages: [] };
    const options = { apiKey: provider.apiKey, headers: { Authorization: "Bearer header-secret" } };
    for (const request of [
      () => streamSimpleByApi(model, context, options),
      () => llm.stream({ model, context, options }),
    ]) {
      if (flag === "true") assert.throws(request, /Direct provider requests are disabled in K-brain mode/);
      else assert.equal(request(), result);
    }
    assert.equal(adapterCalls, flag === "true" ? 0 : 2);
    assert.equal(resolutions, adapterCalls);
  });
}

test("K-brain auxiliary text requests use the backend contract without provider credentials", async () => {
  await withTextHttpFixture(async (baseUrl, requests) => {
    const loader = createTsModuleLoader();
    const { streamAssistantMessage, completeAssistantMessage } = loader.loadModule("src/lib/providers/runtime/textOnlyRuntime.ts");
    const runtime = loadBackendConfig("true", baseUrl).createProviderRuntimeConfig(provider, "gpt-5", undefined);
    const params = {
      providerId: provider.type,
      model: "gpt-5",
      runtime,
      context: { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
      onTextDelta(delta) { assert.equal(delta, "backend text"); },
    };
    const streamed = await streamAssistantMessage(params);
    assert.equal(streamed.content[0].text, "backend text");
    const completed = await completeAssistantMessage(params);
    assert.equal(completed.content[0].text, "backend text");
    assert.equal(completed.provider, provider.id);
    assert.equal(completed.usage.input, 2);
    assert.equal(completed.usage.output, 3);
    assert.equal(completed.usage.totalTokens, 5);
    assert.equal(requests.length, 2);
    for (const { request, body } of requests) {
      assert.equal(request.url, "/v1/text/generate");
      assert.equal(request.headers.authorization, undefined);
      assert.deepEqual(body.model, { provider: provider.id, model: "gpt-5" });
      assert.ok(body.messages.some((message) => message.role === "user"));
      assert.equal(body.messages.some((message) => message.role === "tool" || message.tool_calls), false);
    }
  });
});

test("K-brain selection does not require frontend provider credentials", () => {
  const loader = createTsModuleLoader();
  const { resolveEffectiveChatModelSelection } = loader.loadModule("src/pages/chat/runtime/modelSelection.ts");
  const selectedModel = { customProviderId: provider.id, model: "gpt-5" };
  const selected = resolveEffectiveChatModelSelection({
    settings: { selectedModel, customProviders: [{ ...provider, baseUrl: "", apiKey: "", customHeaders: [] }] },
  });
  assert.deepEqual(selected.selectedModel, selectedModel);
  assert.equal(selected.provider.apiKey, "");
});

test("send preflight gates frontend failover, memory models, title overrides and compaction", () => {
  const source = readFileSync(new URL("../../src/pages/chat/runtime/useSendChatTurn.ts", import.meta.url), "utf8");
  assert.match(source, /const failoverPlan =\s*providerConfig.backend === "direct"\s*\? buildModelFailoverPlan/);
  assert.match(source, /const memorySummaryModelSelection =\s*providerConfig.backend === "direct" \? resolveMemorySummaryModelSelection/);
  assert.match(source, /const titleModelSelection =\s*providerConfig.backend === "direct"\s*\? resolveConversationTitleModelSelection/);
  assert.match(source, /createModelFromConfig\([\s\S]*?providerConfig.baseUrl.trim\(\)/);
  assert.match(source, /complete:\s*providerConfig.backend === "kbrain"[\s\S]*?Frontend compaction is unavailable in K-brain mode/);
});

for (const gateway of [false, true]) {
  test(`K-brain settings discovery blocks fetch, proxy and gateway before reading credentials (gateway=${gateway})`, async () => {
    let proxyCalls = 0;
    let invokeCalls = 0;
    let fetchCalls = 0;
    const utils = loadEnvModule("@liveagent/ui/pages/settings/providerUtils.ts", "true", {
      "../../lib/runtimeEnv": { isGatewayWebuiRuntime: () => gateway },
      "../../lib/providers/proxy": { prepareProxyRequest() { proxyCalls++; assert.fail("proxy called"); } },
      "@liveagent/app/shims/tauriCore": { invoke() { invokeCalls++; assert.fail("gateway called"); } },
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => { fetchCalls++; assert.fail("fetch called"); };
    try {
      for (const type of ["codex", "claude_code", "gemini", "deepseek", "xai"]) {
        await assert.rejects(() => utils.fetchModelsFromApi(type, provider.baseUrl, provider.apiKey, {
          customHeaders: provider.customHeaders,
          modelsUrl: "https://override.test/models?key=override-secret",
        }), (error) => {
          assert.match(error.message, /K-brain mode disables provider model discovery/);
          assert.match(error.message, /chat model picker/);
          assert.doesNotMatch(error.message, /provider-secret|header-secret|query-secret|override-secret/);
          return true;
        });
      }
      const secret = { trim() { assert.fail("credential or URL read before guard"); } };
      await assert.rejects(() => utils.fetchModelsFromApi("codex", secret, secret), /K-brain/);
      assert.deepEqual([proxyCalls, invokeCalls, fetchCalls], [0, 0, 0]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}

for (const flag of [undefined, "false", "TRUE", "1"]) {
  test(`settings discovery preserves direct behavior (flag=${flag})`, async () => {
    const calls = [];
    const utils = loadEnvModule("@liveagent/ui/pages/settings/providerUtils.ts", flag, {
      "../../lib/runtimeEnv": { isGatewayWebuiRuntime: () => false },
      "../../lib/providers/proxy": {
        prepareProxyRequest: async (type, baseUrl, headers) => ({ baseUrl, headers }),
      },
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ data: [{ id: "gpt-5" }] }));
    };
    try {
      assert.equal(utils.getProviderModelDiscoveryUnavailableReason(), null);
      const models = await utils.fetchModelsFromApi("codex", "https://direct.test/v1", "direct-key");
      assert.equal(models[0].id, "gpt-5");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.headers.Authorization, "Bearer direct-key");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}

for (const backend of ["direct", "kbrain", undefined]) {
  test(`global K-brain mode routes auxiliary generation with stale runtime backend=${backend}`, async () => {
    await withTextHttpFixture(async (baseUrl, requests) => {
      let preparations = 0;
      let observers = 0;
      const root = createTsModuleLoader();
      const loader = createTsModuleLoader({
        mocks: {
          [root.resolveLocal("src/lib/providers/runtime/providerRuntimeConfig.ts")]: loadBackendConfig("true", baseUrl),
          [root.resolveLocal("src/lib/providers/runtime/requestOptions.ts")]: {
            prepareProviderRequest() { preparations++; assert.fail("unexpected proxy preparation"); },
          },
        },
      });
      const runtime = { ...provider, backend, backendModelProvider: provider.id };
      const params = {
        providerId: "codex", model: "gpt-5", runtime, context: { messages: [{ role: "user", content: "hello", timestamp: 1 }] },
        onTextDelta() {}, onRequestStart() { observers++; },
      };
      const { streamAssistantMessage, completeAssistantMessage } = loader.loadModule("src/lib/providers/runtime/textOnlyRuntime.ts");
      for (const operation of [streamAssistantMessage, completeAssistantMessage]) {
        const result = await operation(params);
        assert.equal(result.content[0].text, "backend text");
      }
      assert.equal(requests.length, 2);
      assert.equal(preparations, 0);
      assert.equal(observers, 0);
    });
  });
}

test("direct auxiliary entry points retain URL and key validation", async () => {
  const loader = createTsModuleLoader();
  const { streamAssistantMessage, completeAssistantMessage } = loader.loadModule("src/lib/providers/runtime/textOnlyRuntime.ts");
  for (const operation of [streamAssistantMessage, completeAssistantMessage]) {
    const params = { providerId: "codex", model: "gpt-5", context: { messages: [] }, onTextDelta() {} };
    await assert.rejects(() => operation({ ...params, runtime: { backend: "direct", baseUrl: "", apiKey: "" } }), /Base URL cannot be empty/);
    await assert.rejects(() => operation({ ...params, runtime: { backend: "direct", baseUrl: "https://direct.test", apiKey: "" } }), /API Key cannot be empty/);
  }
});

test("provider import adapters expose the K-brain discovery reason instead of a generic fetch failure", () => {
  const source = readFileSync(new URL("../../src/agent-ui-adapters/providerSettings.tsx", import.meta.url), "utf8");
  for (const name of ["syncModels", "importCherry"]) {
    const body = source.slice(source.indexOf(`async function ${name}`));
    assert.ok(body.indexOf("getProviderModelDiscoveryUnavailableReason()") < body.indexOf("await fetchModelsFromApi"));
    assert.match(body, /if \(unavailableReason\) \{\s*setMessage\(unavailableReason\)/);
  }
});
