import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { __memoryExtractorTestInternals } = loader.loadModule("src/lib/chat/memory/memoryExtractor.ts");

const {
  buildDailyAppend,
  extractExplicitRemember,
  latestCompletedTurn,
  shouldWriteDaily,
} = __memoryExtractorTestInternals;

function assistant(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
  };
}

function user(text) {
  return {
    role: "user",
    content: text,
  };
}

test("memory extractor does not convert memory introspection into remembered facts or daily entries", () => {
  assert.deepEqual(extractExplicitRemember("今天你记住了些什么"), []);
  assert.equal(
    shouldWriteDaily(
      "今天你记住了些什么",
      "今天（2026年5月14日）我记住了以下内容：",
    ),
    false,
  );
});

test("memory extractor still captures explicit remember commands", () => {
  const decisions = extractExplicitRemember("请记住：以后默认用陕西腔跟我交流。");

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].scope, "global");
  assert.equal(decisions[0].memoryType, "feedback");
  assert.match(decisions[0].body, /陕西腔/);
});

test("daily append summarizes the latest completed user assistant turn", () => {
  const turn = latestCompletedTurn([
    user("请总结项目"),
    assistant("旧的项目总结"),
    user("我希望你在跟我交流的时候带点北京腔儿～"),
    assistant("好嘞，之后说话带点京味儿。"),
  ]);

  assert.deepEqual(turn, {
    userText: "我希望你在跟我交流的时候带点北京腔儿～",
    assistantText: "好嘞，之后说话带点京味儿。",
  });

  const append = buildDailyAppend({
    conversationId: "160f13c1-caf4-4532-a7fa-1e6b303c9f2d",
    workdir: "/tmp/002",
    ...turn,
  });

  assert.match(append.bullet, /User: 我希望你在跟我交流的时候带点北京腔儿/);
  assert.match(append.bullet, /Assistant: 好嘞，之后说话带点京味儿/);
  assert.doesNotMatch(append.bullet, /旧的项目总结/);
});
