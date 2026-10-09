import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const mod = loader.loadModule("src/lib/settings/legacyProviderImport.ts");

const provider = (id, name, overrides = {}) => ({
  id,
  name,
  type: "openai-compatible",
  baseUrl: "https://example.test/v1",
  isFullUrl: false,
  apiKey: "k",
  models: [{ id: "m1", inputModalities: ["text"] }],
  activeModels: ["m1"],
  reasoning: "medium",
  promptCachingEnabled: false,
  ...overrides,
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
  };
}

test("a rejected provider with unchanged config is not retried", () => {
  const storage = memoryStorage();
  const target = provider("p1", "中转 A");
  mod.writeRejectedLegacyProviders(
    [{ id: "p1", name: "中转 A", fingerprint: mod.legacyProviderFingerprint(target), reason: "shared model", rejectedAt: 1 }],
    storage,
  );
  const rejected = mod.readRejectedLegacyProviders(storage);
  assert.equal(rejected.length, 1);
  assert.deepEqual(mod.legacyProvidersToImport([target], rejected), []);
});

test("editing the provider makes it eligible again", () => {
  const storage = memoryStorage();
  const target = provider("p1", "中转 A");
  const edited = provider("p1", "中转 A", { baseUrl: "https://other.test/v1" });
  mod.writeRejectedLegacyProviders(
    [{ id: "p1", name: "中转 A", fingerprint: mod.legacyProviderFingerprint(target), reason: "shared model", rejectedAt: 1 }],
    storage,
  );
  const rejected = mod.readRejectedLegacyProviders(storage);
  assert.notEqual(mod.legacyProviderFingerprint(target), mod.legacyProviderFingerprint(edited));
  assert.deepEqual(mod.legacyProvidersToImport([edited], rejected), [edited]);
});

test("fingerprint ignores key order and api key changes", () => {
  const a = provider("p1", "A", { apiKey: "one" });
  const b = provider("p1", "A", { apiKey: "two", name: "A renamed" });
  assert.equal(mod.legacyProviderFingerprint(a), mod.legacyProviderFingerprint(b));
});

test("next list keeps only providers that are still missing", () => {
  const kept = provider("p1", "keep");
  const imported = provider("p2", "imported");
  const next = mod.nextRejectedLegacyProviders(
    [
      { id: "p1", name: "keep", fingerprint: mod.legacyProviderFingerprint(kept), reason: "r", rejectedAt: 1 },
      { id: "p2", name: "imported", fingerprint: mod.legacyProviderFingerprint(imported), reason: "r", rejectedAt: 1 },
    ],
    [kept],
    [],
    42,
  );
  assert.deepEqual(next.map((entry) => entry.id), ["p1"]);
});

test("reading a corrupt record degrades to an empty list", () => {
  const storage = memoryStorage();
  storage.setItem(mod.LEGACY_PROVIDER_IMPORT_STORAGE_KEY, "{not json");
  assert.deepEqual(mod.readRejectedLegacyProviders(storage), []);
});

test("the settings load path publishes rejections and never re-imports them", () => {
  const source = readFileSync(new URL("../../src/lib/settings/storage.ts", import.meta.url), "utf8");
  // Regression: a rejected provider used to be re-submitted on every launch.
  assert.match(source, /legacyProvidersToImport\(/);
  assert.match(source, /refreshRejectedLegacyProviders\(\)/);
  assert.match(source, /nextRejectedLegacyProviders\(/);
});
