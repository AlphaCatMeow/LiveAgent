import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createTsModuleLoader } from "../../../agent-gui/test/helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({
  rootDir: fileURLToPath(new URL("../", import.meta.url)),
});
const liveConversationCommit = loader.loadModule("src/lib/liveConversationCommit.ts");

test("appendCommittedLiveEntries keeps later assistant turns even when live ids repeat", () => {
  const firstTurn = liveConversationCommit.appendCommittedLiveEntries([], [
    {
      id: "live-assistant-1",
      kind: "assistant",
      text: "第一轮回复",
      round: 1,
    },
  ]);

  const secondTurn = liveConversationCommit.appendCommittedLiveEntries(firstTurn, [
    {
      id: "live-assistant-1",
      kind: "assistant",
      text: "第二轮回复",
      round: 1,
    },
  ]);

  assert.equal(secondTurn.length, 2);
  assert.deepEqual(
    secondTurn.map((entry) => entry.kind === "assistant" ? entry.text : ""),
    ["第一轮回复", "第二轮回复"],
  );
  assert.notEqual(secondTurn[0].id, secondTurn[1].id);
});

test("appendCommittedLiveEntries is idempotent for the same trailing live replay", () => {
  const liveEntries = [
    {
      id: "live-assistant-1",
      kind: "assistant",
      text: "同一轮最终回复",
      round: 1,
      meta: {
        provider: "openai",
        model: "gpt-5",
      },
    },
  ];

  const committed = liveConversationCommit.appendCommittedLiveEntries([], liveEntries);
  const replayed = liveConversationCommit.appendCommittedLiveEntries(committed, liveEntries);

  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].kind, "assistant");
  assert.equal(replayed[0].text, "同一轮最终回复");
});
