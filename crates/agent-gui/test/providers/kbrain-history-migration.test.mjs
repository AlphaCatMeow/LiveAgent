import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({
  mocks: {
    "@liveagent/app/shims/tauriCore": { invoke: async () => { throw new Error("native invoke not expected"); } },
    "../host": { isTauriHost: () => true },
  },
});
const migration = loader.loadModule("src/lib/kbrain/historyMigration.ts");
const runtime = loader.loadModule("src/lib/kbrain/runtimeConnection.ts");
const mapping = loader.loadModule("src/lib/kbrain/mapping.ts");

test("real migration conversion preserves row IDs, tool IDs, response IDs, ordering, and empty sessions", async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null };
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ source_id: body.source_id, backend_id: body.conversation_id, status: "imported", checkpoint: "unresolved", fingerprint: "fixture" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  runtime.setKBrainRuntimeConnection({ baseUrl, token: "", protocolVersion: "kbrain.agent.v1" });
  try {
    const page = {
      complete: true,
      conversations: [
        {
          id: "legacy-full",
          title: "Legacy",
          providerId: "fixture",
          model: "fixture-model",
          createdAt: 1000,
          updatedAt: 2000,
          isPinned: true,
          isShared: true,
          redactToolContent: true,
          contextMetaJson: JSON.stringify({ systemPrompt: "system" }),
          checkpointStatus: "unresolved",
          segments: [
            { segmentIndex: 1, segmentId: "segment-1", summaryJson: JSON.stringify({ role: "summary", content: "must not replay" }), messagesJson: JSON.stringify([{ role: "user", id: "user-2", content: "later", timestamp: 4 }]) },
            { segmentIndex: 0, segmentId: "segment-0", messagesJson: JSON.stringify([
              { role: "user", id: "user-1", content: "first", timestamp: 1 },
              { role: "assistant", id: "assistant-row", responseId: "user-1", provider: "fixture", model: "fixture-model", content: [{ type: "text", text: "answer" }], timestamp: 2 },
              { role: "toolResult", id: "tool-row", toolCallId: "call-1", toolName: "lookup", content: [{ type: "text", text: "tool output" }], timestamp: 3, isError: false },
            ]) },
          ],
        },
        {
          id: "legacy-empty",
          title: "Draft",
          providerId: "fixture",
          model: "fixture-model",
          createdAt: 1000,
          updatedAt: 1000,
          isPinned: false,
          isShared: false,
          redactToolContent: false,
          contextMetaJson: "{}",
          checkpointStatus: "unresolved",
          segments: [{ segmentIndex: 0, segmentId: "empty-segment", messagesJson: "[]" }],
        },
      ],
    };
    const result = await migration.migrateLegacyHistoryPage(page, { fetch: globalThis.fetch });
    assert.equal(result.failures.length, 0);
    assert.equal(result.results.length, 2);
    assert.equal(requests.length, 2);
    const full = requests.find((request) => request.source_id === "legacy-full");
    assert.deepEqual(full.messages.map((message) => message.id), [undefined, "user-1", "assistant-row", "tool-row", "user-2"]);
    assert.equal(full.messages[2].id, "assistant-row");
    assert.deepEqual(full.messages[2].tool_calls, []);
    assert.deepEqual(full.active_context, { cutoff: 4, summary: "must not replay" });
    assert.equal(full.source_metadata.original.segments[1].messagesJson.includes("responseId"), true);
    assert.equal(full.source_metadata.segments[0].id, "segment-0");
    assert.equal(full.source_metadata.segments[0].summary_json, undefined);
    assert.equal(full.source_metadata.segments[1].messages_json.includes("user-2"), true);
    assert.equal(full.checkpoint.status, "unresolved");
    assert.equal(full.checkpoint.nativePath, "~/.liveagent/checkpoints/legacy-full");
    assert.equal(requests.find((request) => request.source_id === "legacy-empty").messages.length, 0);
    assert.equal(mapping.getKBrainSessionId("legacy-full", baseUrl), "legacy-full");
  } finally {
    runtime.clearKBrainRuntimeConnection();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("checkpoint export is forwarded with source artifact metadata and partial records", async () => {
  runtime.setKBrainRuntimeConnection({ baseUrl: "http://migration.test", token: "", protocolVersion: "kbrain.agent.v1" });
  const calls = [];
  try {
    const result = await migration.migrateLegacyHistoryPage({ complete: true, conversations: [{
      id: "checkpointed", title: "Checkpointed", providerId: "p", model: "m", createdAt: 1, updatedAt: 1,
      isPinned: false, isShared: false, redactToolContent: false, contextMetaJson: "{}", segments: [],
      checkpoint: { status: "partial", nativePath: "~/.liveagent/checkpoints/checkpointed", indexPath: "~/.liveagent/checkpoints/checkpointed/index.jsonl", invalidLines: ["line 4"], records: [{ schema: 2, turnSeq: 3, turnId: "turn-3", root: "/workspace", relPath: "a.txt", kind: "file", existedBefore: true, blob: "hash@v1", blobBase64: "YQ==", size: 1, mtimeMs: 10, capturedAt: 11, mode: 420 }] },
    }] }, { fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ source_id: "checkpointed", backend_id: "checkpointed", status: "imported", checkpoint: "partial", checkpoint_reason: "partial", fingerprint: "fixture" }), { status: 200 }); } });
    assert.equal(result.failures.length, 0);
    assert.equal(calls[0].checkpoint.records[0].blobBase64, "YQ==");
    assert.equal(calls[0].checkpoint.invalidLines[0], "line 4");
    assert.equal(result.results[0].checkpoint, "partial");
    assert.equal(result.complete, false);
  } finally {
    runtime.clearKBrainRuntimeConnection();
  }
});

test("one malformed legacy segment is isolated without aborting other conversations", async () => {
  runtime.setKBrainRuntimeConnection({ baseUrl: "http://migration.test", token: "", protocolVersion: "kbrain.agent.v1" });
  const calls = [];
  try {
    const result = await migration.migrateLegacyHistoryPage({ complete: true, conversations: [
      { id: "bad", title: "bad", providerId: "p", model: "m", createdAt: 1, updatedAt: 1, isPinned: false, isShared: false, redactToolContent: false, contextMetaJson: "{}", checkpointStatus: "unresolved", segments: [{ segmentIndex: 0, segmentId: "bad-segment", messagesJson: "not-json" }] },
      { id: "good", title: "good", providerId: "p", model: "m", createdAt: 1, updatedAt: 1, isPinned: false, isShared: false, redactToolContent: false, contextMetaJson: "{}", checkpointStatus: "unresolved", segments: [{ segmentIndex: 0, segmentId: "good-segment", messagesJson: "[]" }] },
    ] }, { fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ source_id: "good", backend_id: "good", status: "imported", checkpoint: "unresolved", fingerprint: "fixture" }), { status: 200 }); } });
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].sourceId, "bad");
    assert.equal(result.results.length, 1);
    assert.equal(calls[0].source_id, "good");
  } finally {
    runtime.clearKBrainRuntimeConnection();
  }
});

for (const [name, invoke, expectedComplete] of [
  ["native null cursor terminates", async () => ({ conversations: [], nextCursor: null, complete: true }), true],
  ["native export failure remains retryable", async () => { throw new Error("SQLite unavailable"); }, false],
]) {
  test(name, async () => {
    const isolated = createTsModuleLoader({ mocks: {
      "@liveagent/app/shims/tauriCore": { invoke },
      "../host": { isTauriHost: () => true },
    } });
    const connection = isolated.loadModule("src/lib/kbrain/runtimeConnection.ts");
    connection.setKBrainRuntimeConnection({ baseUrl: "http://migration.test", token: "", protocolVersion: "kbrain.agent.v1" });
    const result = await isolated.loadModule("src/lib/kbrain/historyMigration.ts").migrateLegacyHistoryOnce();
    assert.equal(result.complete, expectedComplete);
    assert.equal(result.failures.length, expectedComplete ? 0 : 1);
    connection.clearKBrainRuntimeConnection();
  });
}

test("malformed checkpoint exports fail before transport", async () => {
  runtime.setKBrainRuntimeConnection({ baseUrl: "http://migration.test", token: "", protocolVersion: "kbrain.agent.v1" });
  try {
    const result = await migration.migrateLegacyHistoryPage({ complete: true, conversations: [{ id: "bad-checkpoint", checkpoint: { status: "available", records: [{ schema: 2, turnSeq: 9007199254740992 }] }, segments: [] }] }, { fetch: async () => { throw new Error("transport should not run"); } });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].error, /invalid legacy checkpoint record/);
    assert.equal(result.complete, false);
  } finally { runtime.clearKBrainRuntimeConnection(); }
});
