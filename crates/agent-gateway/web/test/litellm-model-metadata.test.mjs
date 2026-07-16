import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTsModuleLoader } from "../../../agent-gui/test/helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({
  rootDir: fileURLToPath(new URL("..", import.meta.url)),
});
const metadata = loader.loadModule("src/lib/providers/litellmModelMetadata.ts");

test("Gateway WebUI uses the mirrored LiteLLM provider-aware lookup", () => {
  assert.deepEqual(
    metadata.getLiteLlmModelMetadata(
      "anthropic/claude-test",
      "claude_code",
      "https://openrouter.ai/api/v1",
      {
        "anthropic/claude-test": {
          contextWindow: 100000,
          maxOutputToken: 32000,
        },
        "openrouter/anthropic/claude-test": {
          contextWindow: 200000,
          maxOutputToken: 64000,
        },
      },
    ),
    { contextWindow: 200000, maxOutputToken: 64000 },
  );
});
