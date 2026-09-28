import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const sourcePath = new URL("../../../agent-ui/src/pages/settings/KBrainSettingsSection.tsx", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const moduleCode = transformSync(source, { loader: "tsx", format: "cjs", platform: "node", define: { "import.meta.env": "{}" } }).code;
const module = { exports: {} };
new Function("require", "module", "exports", moduleCode)(specifier => {
  if (specifier === "react") return {};
  return {};
}, module, module.exports);

 test("K-brain settings UI sends credentials only as write-only input", () => {
  const update = module.exports.toKBrainProviderUpdate({
    id: "relay",
    name: "Relay",
    api: "openai-completions",
    baseUrl: "https://relay.invalid/v1",
    apiKeyConfigured: true,
    models: [{ provider: "relay", id: "model-a" }],
  }, "new-secret");
  assert.equal(update.apiKey, "new-secret");
  assert.equal(update.baseUrl, "https://relay.invalid/v1");
  assert.deepEqual(update.models, [{ id: "model-a" }]);
  const keep = module.exports.toKBrainProviderUpdate({
    id: "relay",
    name: "Relay",
    api: "openai-completions",
    baseUrl: "https://relay.invalid/v1",
    apiKeyConfigured: true,
    models: [],
  }, "");
  assert.equal(Object.hasOwn(keep, "apiKey"), false);
  const clear = module.exports.toKBrainProviderUpdate({
    id: "relay", name: "Relay", api: "openai-completions", baseUrl: "https://relay.invalid/v1",
    apiKeyConfigured: true, models: [],
  }, "", true);
  assert.equal(clear.clearApiKey, true);
  assert.match(source, /deleteProviders/);
  assert.match(source, /kbrainDeleteProvider/);
  assert.match(source, /removeModel/);
  assert.equal(source.includes("fetchModelsFromApi"), false);
  assert.match(source, /VITE_KBRAIN_URL/);
});
