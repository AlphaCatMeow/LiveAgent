import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const mapping = loader.loadModule("src/lib/kbrain/mapping.ts");
const history = loader.loadModule("src/lib/kbrain/history.ts");
const DEFAULT_KBRAIN_URL = "http://127.0.0.1:47321";

function installStorage() {
  const values = new Map();
  globalThis.localStorage = {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
  return values;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, value, status = 200) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

async function withHttpFixture(handler, callback) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.destroy(error);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const fixtureUrl = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.origin === DEFAULT_KBRAIN_URL) {
      url.protocol = "http:";
      url.host = new URL(fixtureUrl).host;
    }
    return originalFetch(url, init);
  };
  try {
    return await callback(fixtureUrl);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function makeSession(overrides = {}) {
  return {
    id: "remote-session",
    title: "Imported",
    cwd: "/tmp/project",
    model: { provider: "fixture", model: "fixture-model" },
    created_at: "2026-09-28T00:00:00Z",
    updated_at: "2026-09-28T00:01:00Z",
    message_count: 2,
    messages: [
      { id: "u1", role: "user", content: [{ type: "text", text: "hello" }], created_at: "2026-09-28T00:00:01Z" },
      { id: "a1", role: "assistant", content: [{ type: "text", text: "world" }], provider: "fixture", model: "fixture-model", created_at: "2026-09-28T00:00:02Z" },
    ],
    tasks: [
      { id: "child-success", parent_id: "run-1", description: "Review", status: "done", model: { provider: "fixture", model: "fixture-model" }, report: "Reviewed" },
      { id: "child-failed", parent_id: "run-1", description: "Inspect", status: "failed", model: { provider: "fixture", model: "fixture-model" }, error: "upstream failed" },
    ],
    last_seq: 2,
    revision: "rev-1",
    ...overrides,
  };
}

test("K-brain mapping keeps local and backend IDs bidirectionally without sessionId in the key", () => {
  installStorage();
  mapping.setKBrainSessionId("local-conversation", "remote-session", "http://kbrain.test/");
  assert.equal(mapping.getKBrainSessionId("local-conversation", "http://kbrain.test"), "remote-session");
  assert.equal(mapping.getKBrainConversationId("remote-session", "http://kbrain.test"), "local-conversation");
  assert.match([...globalThis.localStorage.getItem("kbrain-session-map:v1")].join(""), /remote-session/);
  assert.doesNotMatch([...globalThis.localStorage.getItem("kbrain-session-map:v1")].join(""), /host-session/);
});

test("production K-brain history uses HTTP list, PATCH model mapping, and get restoration", async () => {
  installStorage();
  const session = makeSession();
  const updated = makeSession({
    model: { provider: "fixture-new", model: "model-2" },
    updated_at: "2026-09-28T00:02:00Z",
  });
  const requests = [];
  await withHttpFixture(async (request, response) => {
    const url = new URL(request.url, DEFAULT_KBRAIN_URL);
    const body = await readBody(request);
    requests.push({ method: request.method, path: url.pathname, body });
    if (request.method === "GET" && url.pathname === "/v1/sessions") return sendJson(response, { sessions: [session] });
    if (request.method === "GET" && url.pathname === "/v1/sessions/remote-session/history") return sendJson(response, { session, revision: session.revision, oldest_offset: 0, has_more_before: false, total_message_count: session.messages.length, ...(url.searchParams.get("include_active") === "true" ? { active_messages: session.messages } : {}) });
    if (request.method === "GET" && url.pathname === "/v1/sessions/remote-session") return sendJson(response, session);
    if (request.method === "PATCH" && url.pathname === "/v1/sessions/remote-session") {
      assert.deepEqual(body, { model: { provider: "fixture-new", model: "model-2" } });
      return sendJson(response, updated);
    }
    return sendJson(response, { error: "unexpected route" }, 404);
  }, async () => {
    const listed = await history.listKBrainHistory(1, 20);
    assert.equal(listed.items.length, 1);
    const localId = listed.items[0].id;
    assert.notEqual(localId, "remote-session");
    assert.equal(listed.items[0].selectedModelJson, '{"customProviderId":"fixture","model":"fixture-model"}');

    const changed = await history.setKBrainHistoryModel(localId, '{"customProviderId":"fixture-new","model":"model-2"}');
    assert.equal(changed.id, localId);
    assert.equal(changed.providerId, "fixture-new");
    assert.equal(changed.model, "model-2");
    assert.equal(changed.selectedModelJson, '{"customProviderId":"fixture-new","model":"model-2"}');

    const window = await history.getKBrainHistoryWindow(localId);
    assert.equal(window.conversation.sessionId, "remote-session");
    assert.equal(window.conversation.model, "fixture-model");
    assert.equal(window.activeSegment.messages.length, 4);
    assert.equal(window.hasMoreBefore, false);
    assert.equal(mapping.getKBrainSessionId(localId), "remote-session");
    assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
      ["GET", "/v1/sessions"],
      ["PATCH", "/v1/sessions/remote-session"],
      ["GET", "/v1/sessions/remote-session/history"],
    ]);
  });
});

test("invalid or null K-brain models fail before any HTTP request", async () => {
  installStorage();
  const requests = [];
  await withHttpFixture(async (request, response) => {
    requests.push({ method: request.method, path: request.url });
    return sendJson(response, { sessions: [makeSession()] });
  }, async () => {
    const listed = await history.listKBrainHistory(1, 20);
    const localId = listed.items[0].id;
    await assert.rejects(() => history.setKBrainHistoryModel(localId, "not-json"), /invalid/);
    await assert.rejects(() => history.setKBrainHistoryModel(localId, null), /invalid/);
    assert.deepEqual(requests, [{ method: "GET", path: "/v1/sessions?page=1&page_size=20" }]);
  });
});

test("task projections are counted once on newest windows while full active context stays intact", async () => {
  installStorage();
  const session = makeSession();
  mapping.setKBrainSessionId("task-local", session.id);
  await withHttpFixture(async (request, response) => {
    const url = new URL(request.url, DEFAULT_KBRAIN_URL);
    const earlier = url.searchParams.has("before_offset");
    return sendJson(response, {
      session: { ...session, messages: session.messages.slice(earlier ? 0 : 1, earlier ? 1 : 2) },
      revision: "rev-1", oldest_offset: earlier ? 0 : 1, has_more_before: !earlier,
      total_message_count: 2,
      ...(url.searchParams.get("include_active") === "true" ? { active_messages: session.messages } : {}),
    });
  }, async () => {
    const tail = await history.getKBrainHistoryWindow("task-local", { maxMessages: 1 });
    assert.equal(tail.activeSegment.messages.length, 4);
    assert.equal(tail.meta.totalMessageCount, 4);
    assert.equal(tail.returnedMessageCount, 3);
    assert.equal(tail.segments[0].startMessageIndex, 1);
    assert.equal(tail.segments[0].messages[1].toolCallId, "kbrain-subagent:child-success");
    const page = await history.getKBrainHistoryWindow("task-local", { maxMessages: 1, beforeOffset: 1, expectedRevision: "rev-1", includeActive: false });
    assert.equal(page.meta.totalMessageCount, 4);
    assert.equal(page.returnedMessageCount, 1);
    assert.equal(page.activeSegment, undefined);
  });
});
