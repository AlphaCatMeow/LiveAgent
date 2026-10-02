import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("managed backend history identity survives port and token rotation without merging remote backends", () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  const loader = createTsModuleLoader();
  const runtime = loader.loadModule("src/lib/kbrain/runtimeConnection.ts");
  const mapping = loader.loadModule("src/lib/kbrain/mapping.ts");
  try {
    runtime.setKBrainRuntimeConnection({ baseUrl: "http://127.0.0.1:40101", token: "first-secret", protocolVersion: "kbrain.agent.v1" });
    mapping.setKBrainSessionId("local-chat", "stored-session", "http://127.0.0.1:40101");
    mapping.setKBrainSessionId("local-chat", "remote-session", "https://remote.example");
    runtime.clearKBrainRuntimeConnection();
    runtime.setKBrainRuntimeConnection({ baseUrl: "http://127.0.0.1:40202", token: "second-secret", protocolVersion: "kbrain.agent.v1" });
    assert.equal(mapping.getKBrainSessionId("local-chat", "http://127.0.0.1:40202"), "stored-session");
    assert.equal(mapping.getKBrainConversationId("stored-session"), "local-chat");
    assert.equal(mapping.getKBrainSessionId("local-chat", "https://remote.example"), "remote-session");
    assert.equal(mapping.getKBrainSessionId("local-chat", "https://other.example"), undefined);
    assert.deepEqual(mapping.listKBrainSessionMappings(), [{ conversationId: "local-chat", sessionId: "stored-session" }]);
    assert.doesNotMatch([...values.values()].join(""), /first-secret|second-secret|40101|40202/);
    mapping.clearKBrainSessionId("local-chat");
    assert.equal(mapping.getKBrainSessionId("local-chat"), undefined);
    assert.equal(mapping.getKBrainSessionId("local-chat", "https://remote.example"), "remote-session");
  } finally {
    runtime.clearKBrainRuntimeConnection();
    globalThis.localStorage = originalStorage;
  }
});
