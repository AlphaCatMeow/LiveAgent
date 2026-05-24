import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function rootPath(...segments) {
  return path.join(
    path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
    ...segments,
  );
}

function createModel(model, customProviderId = model) {
  return {
    providerId: "openai",
    model,
    runtime: {
      baseUrl: `https://${model}.example.test`,
      apiKey: "test-key",
    },
    selectedModel: {
      customProviderId,
      model,
    },
  };
}

const baseParams = {
  sessionId: "session-1",
  conversationId: "conversation-1",
  workdir: "/workspace",
  buildContext: () => ({
    messages: [],
    tools: [],
  }),
};

test("silent memory extraction fallback clears failed configured model and retries current model", async () => {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      [rootPath("src/pages/chat/silentMemoryExtraction.ts")]: {
        async runSilentMemoryExtraction(params) {
          calls.push(params.model);
          if (params.model === "configured-model") {
            return { ok: false, emittedMessages: [] };
          }
          return {
            ok: true,
            emittedMessages: [{ role: "assistant", content: [] }],
          };
        },
      },
    },
  });
  const { runSilentMemoryExtractionWithFallback } = loader.loadModule(
    "src/pages/chat/silentMemoryExtractionFallback.ts",
  );
  const failedModels = [];

  const result = await runSilentMemoryExtractionWithFallback({
    ...baseParams,
    primary: createModel("configured-model", "provider-configured"),
    fallback: createModel("current-model", "provider-current"),
    onPrimaryFailure: (model) => failedModels.push(model.selectedModel),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["configured-model", "current-model"]);
  assert.deepEqual(failedModels, [
    {
      customProviderId: "provider-configured",
      model: "configured-model",
    },
  ]);
});

test("silent memory extraction fallback does not retry or clear on abort", async () => {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      [rootPath("src/pages/chat/silentMemoryExtraction.ts")]: {
        async runSilentMemoryExtraction(params) {
          calls.push(params.model);
          return { ok: false, emittedMessages: [], aborted: true };
        },
      },
    },
  });
  const { runSilentMemoryExtractionWithFallback } = loader.loadModule(
    "src/pages/chat/silentMemoryExtractionFallback.ts",
  );
  const failedModels = [];

  const result = await runSilentMemoryExtractionWithFallback({
    ...baseParams,
    primary: createModel("configured-model", "provider-configured"),
    fallback: createModel("current-model", "provider-current"),
    onPrimaryFailure: (model) => failedModels.push(model.selectedModel),
  });

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.deepEqual(calls, ["configured-model"]);
  assert.deepEqual(failedModels, []);
});
