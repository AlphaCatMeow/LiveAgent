import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// 目标续跑中，回复在等用户回答时暂停目标；用户回复后由下一条消息恢复。
const loader = createTsModuleLoader();
const mod = loader.loadModule("src/lib/kbrain/goalAwaitInput.ts");

test("replies that ask the user something are detected", () => {
  for (const text of [
    "两种方案都可以。你想用哪一种？",
    "改动已准备好。\n\n请确认是否推送到远端。",
    "I can patch either file. Which one should I change?",
    "Draft is ready. Let me know if it works.",
    "**要继续吗？**",
    // 实测回复：问题在段首，说明在段尾。
    "文件标题用什么？正文写几句话？\n我还没有写入文件。另外，全局规则文件位于当前授权工作空间之外。",
    "还在等待你指定文件标题和正文句数，收到后才能写入。例如回复「目标测试，3 句话」。",
    "已问过标题和正文句数，目前尚未收到你的具体回答。请回复这两项，我才能创建文件。",
  ]) {
    assert.equal(mod.assistantAwaitsUserInput(text), true, text);
  }
});

test("progress reports and mid-text rhetorical questions are not", () => {
  for (const text of [
    "",
    "已完成第一步，接下来继续处理测试。",
    "为什么会失败？因为缓存过期了。\n\n已修复缓存，继续执行下一步。",
    "Fixed the parser. Moving on to the tests.",
    '示例代码：\n```js\nconst ok = confirm("继续？");\n```\n已写入文件并验证通过。',
  ]) {
    assert.equal(mod.assistantAwaitsUserInput(text), false, text);
  }
});

test("GOAL_MET is recognized only as the leading token", () => {
  assert.equal(mod.assistantDeclaresGoalMet("GOAL_MET — 已写入并读取核对 goal-test.md。"), true);
  assert.equal(mod.assistantDeclaresGoalMet("**GOAL_MET** done"), true);
  // 实测：工具调用前的话与最终回复拼在同一个文字块里。
  assert.equal(
    mod.assistantDeclaresGoalMet("我会创建 `goal-test3.md`，再读取核对。GOAL_MET — 已创建"),
    true,
  );
  assert.equal(mod.assistantDeclaresGoalMet("还没完成，不是 GOAL_MET。"), false);
  assert.equal(mod.assistantDeclaresGoalMet("GOAL_METRICS ready"), false);
});

test("the awaiting flag is consumed once and can be cleared", () => {
  mod.markGoalAwaitingInput("c1");
  assert.equal(mod.takeGoalAwaitingInput("c1"), true);
  assert.equal(mod.takeGoalAwaitingInput("c1"), false);
  mod.markGoalAwaitingInput("c2");
  mod.clearGoalAwaitingInput("c2");
  assert.equal(mod.takeGoalAwaitingInput("c2"), false);
});
