import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createProviderRuntimeConfig } = loader.loadModule("src/lib/providers/runtime/providerRuntimeConfig.ts");
const { normalizeCustomProvider, DEFAULT_CHAT_RUNTIME_CONTROLS, normalizeChatRuntimeControlsForProvider } = loader.loadModule("src/lib/settings/index.ts");
const { providerSupportsNativeWebSearch, resolveProviderApi } = loader.loadModule("../agent-ui/src/lib/providers/providerCapabilities.ts");
const { buildModelOptions } = loader.loadModule("../agent-ui/src/lib/models/modelOptions.ts");

for (const type of ["deepseek", "codex"]) {
  for (const model of ["deepseek-flash", "deepseek-chat", "deepseek-pro", "deepseek-v4-flash", "gpt-4o-search-preview"]) {
    test(`${type}/${model} only enables the documented Flash server tools`, () => {
      const provider = normalizeCustomProvider({ id: "deepseek", name: "DeepSeek", type, requestFormat: "openai-completions", baseUrl: "https://relay.test/v1", models: [model], activeModels: [model] });
      assert.equal(buildModelOptions({ customProviders: [provider] })[0].nativeWebSearchSupported, model === "deepseek-flash");
      for (const enabled of [true, false]) {
        for (const thinkingEnabled of [true, false]) {
          const controls = Object.freeze({ ...DEFAULT_CHAT_RUNTIME_CONTROLS, nativeWebSearchEnabled: enabled, thinkingEnabled });
          const expected = enabled && model === "deepseek-flash";
          const normalized = normalizeChatRuntimeControlsForProvider(controls, { providerId: type, requestFormat: provider.requestFormat, modelId: model });
          const runtime = createProviderRuntimeConfig(provider, model, controls);
          assert.equal(normalized.nativeWebSearchEnabled, expected);
          assert.equal(runtime.nativeWebSearchEnabled, expected);
          assert.equal(providerSupportsNativeWebSearch(type, resolveProviderApi(type, provider.requestFormat), { modelId: model }), model === "deepseek-flash");
          assert.equal(controls.nativeWebSearchEnabled, enabled);
        }
      }
    });
  }
}
