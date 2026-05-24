import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const {
  recordSilentMemoryDecision,
  recordSilentMemorySkip,
  getSilentMemoryDecisions,
  getRecentSilentMemoryDecisions,
  clearSilentMemoryDecisions,
  resetSilentMemoryDecisionLog,
  subscribeSilentMemoryDecisions,
} = loader.loadModule("src/lib/chat/memory/memoryDecisionLog.ts");

function makeParseResult(parseFailed, items = 1) {
  return {
    ok: !parseFailed,
    parseFailed,
    reason: parseFailed ? "block-1-identify missing" : undefined,
    blocks: parseFailed
      ? {}
      : {
          identify: { items: Array.from({ length: items }, () => ({ fact: "x" })) },
          match: { items: Array.from({ length: items }, () => ({ decision: "NEW" })) },
          plan: { items: Array.from({ length: items }, () => ({ action: "write" })) },
          emit: { text: "记忆整理完成。" },
        },
  };
}

test("recordSilentMemoryDecision stores parsed entries on the conversation log", () => {
  resetSilentMemoryDecisionLog();
  recordSilentMemoryDecision("conv-A", makeParseResult(false, 2));
  const decisions = getSilentMemoryDecisions("conv-A");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].status, "parsed");
  assert.equal(decisions[0].identify.length, 2);
});

test("recordSilentMemoryDecision flags parse-failed entries with the parser reason", () => {
  resetSilentMemoryDecisionLog();
  recordSilentMemoryDecision("conv-B", makeParseResult(true));
  const decisions = getSilentMemoryDecisions("conv-B");
  assert.equal(decisions[0].status, "parse-failed");
  assert.equal(decisions[0].reason, "block-1-identify missing");
});

test("recordSilentMemorySkip emits a 'skipped' entry with the throttling reason", () => {
  resetSilentMemoryDecisionLog();
  recordSilentMemorySkip("conv-C", "greeting");
  const decisions = getSilentMemoryDecisions("conv-C");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].status, "skipped");
  assert.equal(decisions[0].reason, "greeting");
});

test("clearSilentMemoryDecisions wipes only the target conversation", () => {
  resetSilentMemoryDecisionLog();
  recordSilentMemorySkip("conv-D", "greeting");
  recordSilentMemorySkip("conv-E", "throttled-min-interval");
  clearSilentMemoryDecisions("conv-D");
  assert.equal(getSilentMemoryDecisions("conv-D").length, 0);
  assert.equal(getSilentMemoryDecisions("conv-E").length, 1);
});

test("getRecentSilentMemoryDecisions aggregates across conversations newest last", () => {
  resetSilentMemoryDecisionLog();
  recordSilentMemorySkip("conv-F", "greeting", 100);
  recordSilentMemoryDecision("conv-G", makeParseResult(false, 1), 200);
  recordSilentMemorySkip("conv-F", "throttled-min-interval", 300);
  const recent = getRecentSilentMemoryDecisions(10);
  assert.equal(recent.length, 3);
  assert.deepEqual(
    recent.map((entry) => entry.recordedAt),
    [100, 200, 300],
  );
});

test("per-conversation ring buffer keeps only the latest 32 entries", () => {
  resetSilentMemoryDecisionLog();
  for (let i = 0; i < 40; i++) {
    recordSilentMemorySkip("conv-H", `n-${i}`, i);
  }
  const decisions = getSilentMemoryDecisions("conv-H");
  assert.equal(decisions.length, 32);
  assert.equal(decisions[0].reason, "n-8");
  assert.equal(decisions[31].reason, "n-39");
});

test("subscribeSilentMemoryDecisions delivers new entries until unsubscribed", () => {
  resetSilentMemoryDecisionLog();
  const events = [];
  const unsubscribe = subscribeSilentMemoryDecisions((entry) => events.push(entry.reason));
  recordSilentMemorySkip("conv-I", "greeting");
  recordSilentMemoryDecision("conv-I", makeParseResult(true));
  unsubscribe();
  recordSilentMemorySkip("conv-I", "after-unsubscribe");
  assert.deepEqual(events, ["greeting", "block-1-identify missing"]);
});
