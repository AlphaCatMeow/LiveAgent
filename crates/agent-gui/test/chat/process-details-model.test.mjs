import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const model = loader.loadModule("src/lib/chat/processDetailsModel.ts");

function round(key, blocks, meta) {
  return { key, blocks, ...(meta ? { meta } : {}) };
}

function kinds(partitionedRounds) {
  return partitionedRounds.flatMap((entry) => entry.blocks.map((block) => block.kind));
}

test("plain assistant text stays outside process details", () => {
  const sourceRound = round("r1", [{ kind: "text", id: "text-1", text: "Final answer" }]);
  const partition = model.partitionAssistantResponse([sourceRound]);

  assert.equal(partition.hasProcessDetails, false);
  assert.equal(partition.hasSubstantiveAnswer, true);
  assert.deepEqual(partition.processRounds, []);
  assert.equal(partition.answerRounds[0].round, sourceRound);
  assert.equal(partition.answerRounds[0].blocks[0], sourceRound.blocks[0]);
});

test("thinking, intermediate narration, tools, and hosted search form one cross-round process", () => {
  const rounds = [
    round("r1", [
      { kind: "thinking", id: "thinking-1", text: "Plan" },
      { kind: "text", id: "text-1", text: "I will inspect this." },
    ]),
    round("r2", [
      { kind: "tool", item: { toolCall: { id: "call-1" } } },
      { kind: "hostedSearch", item: { id: "search-1" } },
      { kind: "text", id: "text-2", text: "Here is the result." },
    ]),
  ];

  const partition = model.partitionAssistantResponse(rounds);

  assert.equal(partition.hasProcessDetails, true);
  assert.equal(partition.hasSubstantiveAnswer, true);
  assert.deepEqual(kinds(partition.processRounds), ["thinking", "text", "tool", "hostedSearch"]);
  assert.deepEqual(kinds(partition.answerRounds), ["text"]);
  assert.equal(partition.answerRounds[0].blocks[0].id, "text-2");
});

test("a later process event reclassifies earlier narration and removes the final-answer boundary", () => {
  const partition = model.partitionAssistantResponse([
    round("r1", [
      { kind: "thinking", id: "thinking-1", text: "Plan" },
      { kind: "text", id: "text-1", text: "Possible answer" },
      { kind: "tool", item: { toolCall: { id: "call-2" } } },
    ]),
  ]);

  assert.deepEqual(kinds(partition.processRounds), ["thinking", "text", "tool"]);
  assert.deepEqual(partition.answerRounds, []);
  assert.equal(partition.hasSubstantiveAnswer, false);
});

test("streaming partition preserves provisional text when a later process event arrives", () => {
  const partition = model.partitionAssistantResponse(
    [
      round("r1", [
        { kind: "thinking", id: "thinking-1", text: "Plan" },
        { kind: "text", id: "text-1", text: "Possible answer" },
        { kind: "tool", item: { toolCall: { id: "call-2" } } },
      ]),
    ],
    { preserveStreamingText: true },
  );

  assert.deepEqual(kinds(partition.processRounds), ["thinking", "tool"]);
  assert.deepEqual(kinds(partition.answerRounds), ["text"]);
  assert.equal(partition.hasSubstantiveAnswer, true);
});

test("process-only, cancelled, or whitespace-only replies remain open", () => {
  const partition = model.partitionAssistantResponse([
    round("r1", [
      { kind: "thinking", id: "thinking-1", text: "Plan" },
      { kind: "text", id: "text-1", text: "   " },
    ]),
  ]);

  assert.equal(partition.hasSubstantiveAnswer, false);
  assert.equal(
    model.getProcessDetailsDefaultOpen({
      hasSubstantiveAnswer: partition.hasSubstantiveAnswer,
      expandByDefault: false,
    }),
    true,
  );
});

test("completed replies follow the local expand-by-default preference", () => {
  assert.equal(
    model.getProcessDetailsDefaultOpen({
      hasSubstantiveAnswer: true,
      expandByDefault: false,
    }),
    false,
  );
  assert.equal(
    model.getProcessDetailsDefaultOpen({
      hasSubstantiveAnswer: true,
      expandByDefault: true,
    }),
    true,
  );
});

test("terminal failures, unresolved tool errors, and timeouts request automatic visibility", () => {
  const completedBlocks = [
    { kind: "thinking", id: "thinking-1", text: "Plan" },
    { kind: "text", id: "text-1", text: "Final answer" },
  ];

  for (const stopReason of ["aborted", "error"]) {
    assert.equal(
      model.shouldForceProcessDetailsOpen([round("r1", completedBlocks, { stopReason })]),
      true,
    );
  }
  assert.equal(
    model.shouldForceProcessDetailsOpen([
      round("r1", [
        { kind: "thinking", id: "thinking-1", text: "Plan" },
        {
          kind: "tool",
          item: {
            toolCall: { id: "call-1" },
            toolResult: { isError: true, details: {} },
          },
        },
      ]),
    ]),
    true,
  );
  assert.equal(
    model.shouldForceProcessDetailsOpen([
      round("r1", [
        { kind: "thinking", id: "thinking-1", text: "Plan" },
        {
          kind: "tool",
          item: {
            toolCall: { id: "question-1" },
            toolResult: {
              isError: false,
              details: { kind: "ask_user_question", timedOut: true },
            },
          },
        },
        { kind: "text", id: "text-1", text: "Final answer" },
      ]),
    ]),
    true,
  );
  assert.equal(model.shouldForceProcessDetailsOpen([round("r1", completedBlocks)]), false);
});

test("a recovered tool error does not override the final-answer disclosure preference", () => {
  assert.equal(
    model.shouldForceProcessDetailsOpen([
      round("r1", [
        { kind: "thinking", id: "thinking-1", text: "Plan" },
        {
          kind: "tool",
          item: {
            toolCall: { id: "call-1" },
            toolResult: { isError: true, details: {} },
          },
        },
        { kind: "text", id: "text-1", text: "Recovered final answer" },
      ]),
    ]),
    false,
  );
});
