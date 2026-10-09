import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({
  mocks: {
    "@liveagent/app/shims/tauriCore": {
      invoke: async () => {
        throw new Error("native invoke not expected");
      },
    },
    "../host": { isTauriHost: () => true },
  },
});
const failures = loader.loadModule("src/lib/kbrain/historyMigrationFailures.ts");
const migration = loader.loadModule("src/lib/kbrain/historyMigration.ts");
const runtime = loader.loadModule("src/lib/kbrain/runtimeConnection.ts");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function page(id = "big-one", text = "old question") {
  return {
    complete: true,
    conversations: [
      {
        id,
        title: "A long conversation",
        providerId: "removed",
        model: "removed-model",
        createdAt: 1000,
        updatedAt: 2000,
        isPinned: false,
        isShared: false,
        redactToolContent: false,
        contextMetaJson: "{}",
        checkpoint: { status: "not_found" },
        segments: [
          {
            segmentIndex: 0,
            segmentId: "first",
            messagesJson: JSON.stringify([{ id: "u1", role: "user", content: text, timestamp: 1000 }]),
          },
        ],
      },
    ],
  };
}

test("classification separates deterministic failures from transient ones", () => {
  const limit = failures.KBRAIN_REQUEST_BODY_LIMIT_BYTES;
  const classify = failures.classifyHistoryMigrationFailure;
  assert.equal(classify({ message: "Failed to fetch", bytes: limit + 1 }), "too_large");
  assert.equal(classify({ message: "Failed to fetch", bytes: limit - 1 }), "transient");
  assert.equal(classify({ message: "Failed to fetch" }), "transient");
  assert.equal(classify({ status: 413, message: "too big" }), "too_large");
  assert.equal(classify({ status: 409, message: "conflict" }), "conflict");
  assert.equal(classify({ status: 400, message: "bad" }), "rejected");
  assert.equal(classify({ status: 500, message: "boom" }), "transient");
  assert.equal(failures.isDeterministicHistoryMigrationFailure("transient"), false);
});

test("merge drops records for conversations that now succeed", () => {
  const record = (sourceId, kind = "too_large") => ({
    sourceId,
    title: sourceId,
    fingerprint: "f",
    kind,
    message: "m",
    failedAt: 1,
  });
  const merged = failures.mergeHistoryMigrationFailures([record("a"), record("b")], {
    succeeded: ["a"],
    failed: [record("c", "conflict")],
  });
  assert.deepEqual(
    merged.map((entry) => entry.sourceId),
    ["b", "c"],
  );
});

test("dismissal hides the notice but keeps the settings list", () => {
  const storage = memoryStorage();
  const scope = "dismiss-scope";
  const record = { sourceId: "x", title: "X", fingerprint: "f1", kind: "too_large", message: "m", failedAt: 1 };
  failures.writeHistoryMigrationFailures(scope, [record], storage);
  failures.dismissHistoryMigrationFailures(scope, [record], storage);
  const dismissed = failures.readDismissedHistoryMigrationFailures(scope, storage);
  assert.equal(dismissed.has("x:f1"), true);
  assert.equal(failures.readHistoryMigrationFailures(scope, storage).length, 1);
});

test("startup skips a conversation that already failed for size; manual import retries it", async () => {
  globalThis.localStorage = memoryStorage();
  runtime.setKBrainRuntimeConnection({
    baseUrl: "http://migration-failures.test",
    token: "",
    protocolVersion: "kbrain.agent.v1",
  });
  // Big enough to exceed the 4 MiB body limit once serialized.
  const bigPage = () => page("big-one", "x".repeat(failures.KBRAIN_REQUEST_BODY_LIMIT_BYTES));
  let posts = 0;
  let accept = false;
  const fetch = async (_url, init) => {
    if (init.method === "POST") {
      posts++;
      if (!accept) throw new TypeError("Failed to fetch");
      return new Response(
        JSON.stringify({
          source_id: "big-one",
          backend_id: "big-one",
          status: "imported",
          checkpoint: "not_found",
          fingerprint: "fp",
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  };
  try {
    const first = await migration.migrateLegacyHistoryPage(bigPage(), { fetch });
    assert.equal(posts, 1);
    assert.equal(first.failures[0].kind, "too_large");
    assert.ok(first.failures[0].bytes > failures.KBRAIN_REQUEST_BODY_LIMIT_BYTES);

    // Next launch: same content, no re-upload, but still reported (as skipped).
    const second = await migration.migrateLegacyHistoryPage(bigPage(), { fetch });
    assert.equal(posts, 1);
    assert.equal(second.failures.length, 1);
    assert.equal(second.failures[0].skipped, true);
    assert.equal(second.complete, false);

    // Manual import retries; once K-brain accepts it, the record is cleared.
    accept = true;
    const manual = await migration.migrateLegacyHistoryPage(bigPage(), {
      fetch,
      retryKnownFailures: true,
    });
    assert.equal(posts, 2);
    assert.equal(manual.failures.length, 0);
    const scope = loader.loadModule("src/lib/kbrain/mapping.ts").kBrainStorageScope();
    assert.equal(failures.readHistoryMigrationFailures(scope).length, 0);
  } finally {
    runtime.clearKBrainRuntimeConnection();
  }
});

test("a transient failure is retried on the next launch", async () => {
  globalThis.localStorage = memoryStorage();
  runtime.setKBrainRuntimeConnection({
    baseUrl: "http://migration-transient.test",
    token: "",
    protocolVersion: "kbrain.agent.v1",
  });
  let posts = 0;
  const fetch = async (_url, init) => {
    if (init.method === "POST") {
      posts++;
      throw new TypeError("Failed to fetch");
    }
    return new Response("{}", { status: 404 });
  };
  try {
    await migration.migrateLegacyHistoryPage(page("small"), { fetch });
    await migration.migrateLegacyHistoryPage(page("small"), { fetch });
    assert.equal(posts, 2);
  } finally {
    runtime.clearKBrainRuntimeConnection();
  }
});

test("only the import POST can produce a deterministic failure record", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("../../src/lib/kbrain/historyMigration.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /importAttempted = true;\s+const result = await client\.importLegacyHistory/);
  assert.match(source, /const kind = importAttempted\s+\? classifyHistoryMigrationFailure/);
});
