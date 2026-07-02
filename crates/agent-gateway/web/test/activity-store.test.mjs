import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const loader = createWebModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});

const { createActivityStore } = loader.loadModule("src/lib/chat/stream/activityStore.ts");

test("activity events drive the running map with run identity", () => {
  const store = createActivityStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  store.applyActivityEvent({
    conversationId: "conv-1",
    runId: "run-1",
    running: true,
    state: "running",
    workdir: "/workspace",
    updatedAt: 10,
  });
  assert.equal(store.isRunning("conv-1"), true);
  assert.equal(store.get("conv-1")?.runId, "run-1");
  assert.equal(notifications, 1);

  // Duplicate state is ignored.
  store.applyActivityEvent({
    conversationId: "conv-1",
    runId: "run-1",
    running: true,
    state: "running",
    workdir: "/workspace",
    updatedAt: 11,
  });
  assert.equal(notifications, 1);

  // A stale event (older than what we show) is ignored.
  store.applyActivityEvent({
    conversationId: "conv-1",
    runId: "run-0",
    running: true,
    state: "running",
    workdir: "/workspace",
    updatedAt: 5,
  });
  assert.equal(store.get("conv-1")?.runId, "run-1");

  store.applyActivityEvent({
    conversationId: "conv-1",
    runId: "run-1",
    running: false,
    state: null,
    workdir: null,
    updatedAt: 20,
  });
  assert.equal(store.isRunning("conv-1"), false);
  assert.equal(notifications, 2);
});

test("hydration replaces the map from history.list", () => {
  const store = createActivityStore();
  store.applyActivityEvent({
    conversationId: "conv-stale",
    runId: "run-stale",
    running: true,
    state: "running",
    workdir: null,
    updatedAt: 1,
  });

  store.hydrate([
    { conversationId: "conv-1", runId: "run-1", state: "running", workdir: "/w", updatedAt: 2 },
    { conversationId: "conv-2", runId: "run-2", state: "cancelling", updatedAt: 3 },
  ]);

  assert.equal(store.isRunning("conv-stale"), false, "hydration is authoritative");
  assert.equal(store.get("conv-1")?.runId, "run-1");
  assert.equal(store.get("conv-2")?.state, "cancelling");
});
