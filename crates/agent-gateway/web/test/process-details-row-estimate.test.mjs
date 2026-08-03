import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

const loader = createWebModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});
const { estimateAssistantResponseRowHeight } = loader.loadModule(
  "src/lib/transcript-virtual/assistantResponseEstimate.ts",
);

function round(blocks, meta) {
  return { blocks, ...(meta ? { meta } : {}) };
}

test("completed replies estimate one process header while collapsed", () => {
  const rounds = [
    round([
      { kind: "thinking", text: "reasoning ".repeat(500) },
      { kind: "tool", item: { toolCall: { name: "Read" } } },
      { kind: "text", text: "Final answer" },
    ]),
  ];

  const collapsed = estimateAssistantResponseRowHeight(rounds, false);
  const expanded = estimateAssistantResponseRowHeight(rounds, true);

  assert.ok(expanded > collapsed * 3, `${expanded} should greatly exceed ${collapsed}`);
});

test("process-only replies estimate as open regardless of the setting", () => {
  const rounds = [
    round([
      { kind: "thinking", text: "still working ".repeat(100) },
      { kind: "tool", item: { toolCall: { name: "Read" } } },
    ]),
  ];

  assert.equal(
    estimateAssistantResponseRowHeight(rounds, false),
    estimateAssistantResponseRowHeight(rounds, true),
  );
});

test("artifacts outside the disclosure retain a collapsed-height reserve", () => {
  const base = [
    round([
      { kind: "thinking", text: "plan" },
      { kind: "text", text: "Done" },
    ]),
  ];
  const withArtifacts = [
    round([
      { kind: "thinking", text: "plan" },
      {
        kind: "tool",
        item: {
          toolCall: { name: "Write" },
          toolResult: { isError: false, details: { path: "README.md" } },
        },
      },
      {
        kind: "tool",
        item: {
          toolCall: { name: "Image" },
          toolResult: { isError: false, details: { kind: "display_image" } },
        },
      },
      { kind: "text", text: "Done" },
    ]),
  ];

  assert.ok(
    estimateAssistantResponseRowHeight(withArtifacts, false) >
      estimateAssistantResponseRowHeight(base, false),
  );
});

test("answering, failed, and timed-out process details use the correct open estimate", () => {
  const completedBlocks = [
    { kind: "thinking", text: "reasoning ".repeat(200) },
    { kind: "text", text: "Final answer" },
  ];
  const normal = [round(completedBlocks)];
  const collapsed = estimateAssistantResponseRowHeight(normal, false);
  const expanded = estimateAssistantResponseRowHeight(normal, true);
  assert.ok(expanded > collapsed);

  const failed = [round(completedBlocks, { stopReason: "error" })];
  assert.equal(
    estimateAssistantResponseRowHeight(failed, false),
    estimateAssistantResponseRowHeight(failed, true),
  );

  const timedOut = [
    round([
      { kind: "thinking", text: "reasoning ".repeat(200) },
      {
        kind: "tool",
        item: {
          toolCall: { name: "AskUserQuestion" },
          toolResult: {
            isError: false,
            details: { kind: "ask_user_question", timedOut: true },
          },
        },
      },
      { kind: "text", text: "Final answer" },
    ]),
  ];
  assert.equal(
    estimateAssistantResponseRowHeight(timedOut, false),
    estimateAssistantResponseRowHeight(timedOut, true),
  );
});
