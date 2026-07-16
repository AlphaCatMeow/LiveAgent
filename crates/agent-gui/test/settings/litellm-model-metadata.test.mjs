import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const metadata = loader.loadModule("src/lib/providers/litellmModelMetadata.ts");

const modelMap = {
  "exact-model": { contextWindow: 111, maxOutputToken: 11 },
  "gemini/gemini-test": { contextWindow: 222, maxOutputToken: 22 },
  "openrouter/anthropic/claude-test": { contextWindow: 333, maxOutputToken: 33 },
  "deepseek/deepseek-chat": { contextWindow: 444, maxOutputToken: 44 },
  "other/vendor/shared-name": { contextWindow: 555, maxOutputToken: 55 },
  "provider-conflict": { contextWindow: 666, maxOutputToken: 66 },
  "openrouter/provider-conflict": { contextWindow: 777, maxOutputToken: 77 },
  "gemini-conflict": { contextWindow: 888, maxOutputToken: 88 },
  "gemini/gemini-conflict": { contextWindow: 999, maxOutputToken: 99 },
  malformed: { contextWindow: 0, maxOutputToken: "bad" },
  partial: { contextWindow: "1000" },
};

test("LiteLLM lookup resolves exact keys and deterministic provider prefixes", () => {
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata(
      "exact-model",
      "codex",
      "https://openrouter.ai/api/v1",
      modelMap,
    ),
    { contextWindow: 111, maxOutputToken: 11 },
  );
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata(
      "gemini-test",
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta",
      modelMap,
    ),
    { contextWindow: 222, maxOutputToken: 22 },
  );
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata(
      "anthropic/claude-test",
      "claude_code",
      "https://openrouter.ai/api/v1",
      modelMap,
    ),
    { contextWindow: 333, maxOutputToken: 33 },
  );
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata(
      "deepseek-chat",
      "codex",
      "https://api.deepseek.com/v1",
      modelMap,
    ),
    { contextWindow: 444, maxOutputToken: 44 },
  );
});

test("LiteLLM lookup prefers endpoint-specific entries over conflicting exact keys", () => {
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata(
      "provider-conflict",
      "codex",
      "https://openrouter.ai/api/v1",
      modelMap,
    ),
    { contextWindow: 777, maxOutputToken: 77 },
  );
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata(
      "gemini-conflict",
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta",
      modelMap,
    ),
    { contextWindow: 999, maxOutputToken: 99 },
  );
});

test("LiteLLM lookup does not use unknown hosts or basename matching", () => {
  assert.equal(
    metadata.getLiteLlmModelMetadata(
      "anthropic/claude-test",
      "claude_code",
      "https://relay.example.com/v1",
      modelMap,
    ),
    undefined,
  );
  assert.equal(
    metadata.getLiteLlmModelMetadata(
      "shared-name",
      "codex",
      "https://relay.example.com/v1",
      modelMap,
    ),
    undefined,
  );
});

test("LiteLLM lookup validates optional fields independently", () => {
  assert.equal(
    metadata.getLiteLlmModelMetadata("malformed", "codex", "not-a-url", modelMap),
    undefined,
  );
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata("partial", "codex", "not-a-url", modelMap),
    { contextWindow: 1000 },
  );
});
