import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSnapshot,
  main,
  serializeSnapshot,
} from "../../../../scripts/update-litellm-model-metadata.mjs";

const fixturePath = fileURLToPath(
  new URL("../fixtures/litellm-model-metadata.input.json", import.meta.url),
);
const FIXTURE_REVISION = "0000000000000000000000000000000000000001";

test("LiteLLM snapshot generation trims fields and remains deterministic", async () => {
  const input = readFileSync(fixturePath);
  const snapshot = buildSnapshot(input, FIXTURE_REVISION.toUpperCase());

  assert.deepEqual(Object.keys(snapshot.models), [
    "a-fallback",
    "b-context-only",
    "c-null-fallback",
    "z-direct",
  ]);
  assert.deepEqual(snapshot.models["a-fallback"], {
    contextWindow: 64,
    maxOutputToken: 64,
  });
  assert.deepEqual(snapshot.models["b-context-only"], { contextWindow: 128 });
  assert.deepEqual(snapshot.models["c-null-fallback"], {
    contextWindow: 256,
    maxOutputToken: 256,
  });
  assert.deepEqual(snapshot.models["z-direct"], {
    contextWindow: 100,
    maxOutputToken: 20,
  });
  assert.equal(snapshot.models["invalid-values"], undefined);
  assert.deepEqual(snapshot.source, {
    repository: "BerriAI/litellm",
    revision: FIXTURE_REVISION,
    path: "model_prices_and_context_window.json",
    sha256: createHash("sha256").update(input).digest("hex"),
    license: "MIT",
  });
  assert.equal(serializeSnapshot(snapshot), serializeSnapshot(buildSnapshot(input, FIXTURE_REVISION)));
});

test("LiteLLM snapshot generation rejects invalid roots and uses locale-independent key ordering", () => {
  assert.throws(
    () => buildSnapshot(Buffer.from("not-json"), FIXTURE_REVISION),
    /not valid JSON/,
  );
  assert.throws(
    () => buildSnapshot(Buffer.from("[]"), FIXTURE_REVISION),
    /root must be an object/,
  );

  const snapshot = buildSnapshot(
    Buffer.from(
      JSON.stringify({
        "vendor/z-model": { max_tokens: 10 },
        "vendor/A-model": { max_tokens: 20 },
      }),
    ),
    FIXTURE_REVISION,
  );
  assert.deepEqual(Object.keys(snapshot.models), ["vendor/A-model", "vendor/z-model"]);
});

test("LiteLLM snapshot generation requires an immutable Git commit revision", () => {
  const input = readFileSync(fixturePath);
  assert.throws(() => buildSnapshot(input, "main"), /40-character Git commit SHA/);
  assert.throws(() => buildSnapshot(input, "   "), /40-character Git commit SHA/);
  assert.throws(() => buildSnapshot(input, "abc123"), /40-character Git commit SHA/);
});

test("local generator mode writes identical destinations and is idempotent", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "liveagent-litellm-"));
  const guiOutput = path.join(directory, "gui", "metadata.json");
  const webOutput = path.join(directory, "web", "metadata.json");

  try {
    const args = [
      "--input",
      fixturePath,
      "--revision",
      FIXTURE_REVISION,
      "--gui-output",
      guiOutput,
      "--web-output",
      webOutput,
    ];
    await main(args);
    const firstGui = readFileSync(guiOutput);
    const firstWeb = readFileSync(webOutput);
    assert.deepEqual(firstGui, firstWeb);

    await main(args);
    assert.deepEqual(readFileSync(guiOutput), firstGui);
    assert.deepEqual(readFileSync(webOutput), firstWeb);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
