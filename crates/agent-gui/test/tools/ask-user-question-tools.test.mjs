import assert from "node:assert/strict";
import test from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import * as typebox from "typebox";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function loadModules() {
  const loader = createTsModuleLoader({ mocks: { typebox } });
  return {
    shared: loader.loadModule("src/lib/chat/askUserQuestion.ts"),
    tools: loader.loadModule("src/lib/tools/askUserQuestionTools.ts"),
  };
}

function buildQuestionsArgs() {
  return {
    questions: [
      {
        id: "storage",
        header: "存储",
        prompt: "配置应当存放在哪里？",
        options: [
          { label: "应用数据目录", description: "不污染工作区", recommended: true },
          { label: "工作区根目录" },
          { label: "自定义路径" },
        ],
      },
      {
        prompt: "是否需要迁移旧数据？",
        options: [{ label: "迁移" }, { label: "不迁移", recommended: true }],
      },
    ],
  };
}

function createToolCall(argumentsValue, id = "call-ask-1") {
  return { type: "toolCall", id, name: "AskUserQuestion", arguments: argumentsValue };
}

test("AskUserQuestion schema accepts well-formed questions", () => {
  const { tools } = loadModules();
  const bundle = tools.createAskUserQuestionTools({ conversationId: "conv-1" });
  const tool = bundle.tools.find((candidate) => candidate.name === "AskUserQuestion");
  assert.ok(tool);

  const args = validateToolArguments(tool, createToolCall(buildQuestionsArgs()));
  assert.equal(args.questions.length, 2);
});

test("parseAskUserQuestionItems enforces limits, ids, and single recommendation", () => {
  const { shared } = loadModules();

  assert.throws(() => shared.parseAskUserQuestionItems([]), /non-empty/);
  assert.throws(
    () =>
      shared.parseAskUserQuestionItems(
        Array.from({ length: 5 }, (_, index) => ({
          prompt: `q${index}`,
          options: [{ label: "a" }, { label: "b" }],
        })),
      ),
    /at most 4 questions/,
  );
  assert.throws(
    () => shared.parseAskUserQuestionItems([{ prompt: "只有一个选项？", options: [{ label: "a" }] }]),
    /needs 2-6 options/,
  );
  assert.throws(
    () =>
      shared.parseAskUserQuestionItems([
        {
          prompt: "重复推荐",
          options: [
            { label: "a", recommended: true },
            { label: "b", recommended: true },
          ],
        },
      ]),
    /at most one option as recommended/,
  );
  assert.throws(
    () =>
      shared.parseAskUserQuestionItems([
        { prompt: "重复标签", options: [{ label: "same" }, { label: "same" }] },
      ]),
    /duplicate option label/,
  );
  assert.throws(
    () =>
      shared.parseAskUserQuestionItems([
        { id: "dup", prompt: "一", options: [{ label: "a" }, { label: "b" }] },
        { id: "dup", prompt: "二", options: [{ label: "a" }, { label: "b" }] },
      ]),
    /duplicate question id/,
  );

  const parsed = shared.parseAskUserQuestionItems(buildQuestionsArgs().questions);
  assert.deepEqual(
    parsed.map((question) => question.id),
    ["storage", "q2"],
  );
  assert.equal(parsed[0].options[0].recommended, true);
});

test("sanitizeAskUserQuestionItems tolerates streaming partial arguments", () => {
  const { shared } = loadModules();
  assert.deepEqual(shared.sanitizeAskUserQuestionItems(undefined), []);
  assert.deepEqual(shared.sanitizeAskUserQuestionItems([{ prompt: "缺选项" }]), []);

  const partial = shared.sanitizeAskUserQuestionItems([
    { prompt: "已成形的问题", options: [{ label: "选项 A", recommended: true }, { label: "" }] },
    { prompt: "", options: [{ label: "x" }] },
  ]);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].id, "q1");
  assert.deepEqual(partial[0].options, [{ label: "选项 A", recommended: true }]);
});

test("execute suspends until the user answers, then returns the selections", async () => {
  const { tools } = loadModules();
  const bundle = tools.createAskUserQuestionTools({ conversationId: "conv-1" });
  const toolCall = createToolCall(buildQuestionsArgs(), "call-ask-answer");

  const resultPromise = bundle.executeToolCall(toolCall);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tools.hasPendingAskUserQuestion("call-ask-answer"), true);

  // 非法应答（缺第二题）不落定，也不清挂起态。
  const invalid = tools.answerAskUserQuestion("call-ask-answer", [
    { questionId: "storage", selectedLabel: "应用数据目录" },
  ]);
  assert.equal(invalid.ok, false);
  assert.equal(tools.hasPendingAskUserQuestion("call-ask-answer"), true);

  // 选项必须来自问题定义。
  const wrongLabel = tools.answerAskUserQuestion("call-ask-answer", [
    { questionId: "storage", selectedLabel: "不存在的选项" },
    { questionId: "q2", selectedLabel: "迁移" },
  ]);
  assert.equal(wrongLabel.ok, false);

  const accepted = tools.answerAskUserQuestion("call-ask-answer", [
    { questionId: "storage", selectedLabel: "应用数据目录" },
    { questionId: "q2", selectedLabel: "不迁移" },
  ]);
  assert.equal(accepted.ok, true);

  const result = await resultPromise;
  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "ask_user_question");
  assert.deepEqual(
    result.details.answers.map((answer) => answer.selectedLabel),
    ["应用数据目录", "不迁移"],
  );
  assert.match(result.content[0].text, /proceed accordingly/);
  assert.match(result.content[0].text, /应用数据目录/);
  assert.equal(tools.hasPendingAskUserQuestion("call-ask-answer"), false);

  // 已落定的提问不能再次应答。
  const late = tools.answerAskUserQuestion("call-ask-answer", []);
  assert.equal(late.ok, false);
});

test("abort settles a pending question as cancelled", async () => {
  const { tools } = loadModules();
  const bundle = tools.createAskUserQuestionTools({ conversationId: "conv-1" });
  const controller = new AbortController();
  const toolCall = createToolCall(buildQuestionsArgs(), "call-ask-abort");

  const resultPromise = bundle.executeToolCall(toolCall, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();

  const result = await resultPromise;
  assert.equal(result.isError, true);
  assert.equal(result.details.cancelled, true);
  assert.deepEqual(result.details.answers, []);
  assert.match(result.content[0].text, /stopped the turn/);
  assert.equal(tools.hasPendingAskUserQuestion("call-ask-abort"), false);
});

test("conversation disposal cancels its pending questions only", async () => {
  const { tools } = loadModules();
  const bundleA = tools.createAskUserQuestionTools({ conversationId: "conv-a" });
  const bundleB = tools.createAskUserQuestionTools({ conversationId: "conv-b" });

  const promiseA = bundleA.executeToolCall(createToolCall(buildQuestionsArgs(), "call-ask-a"));
  const promiseB = bundleB.executeToolCall(createToolCall(buildQuestionsArgs(), "call-ask-b"));
  await new Promise((resolve) => setTimeout(resolve, 10));

  tools.cancelPendingAskUserQuestionsForConversation("conv-a");
  const resultA = await promiseA;
  assert.equal(resultA.details.cancelled, true);
  assert.equal(tools.hasPendingAskUserQuestion("call-ask-b"), true);

  const accepted = tools.answerAskUserQuestion("call-ask-b", [
    { questionId: "storage", selectedLabel: "工作区根目录" },
    { questionId: "q2", selectedLabel: "迁移" },
  ]);
  assert.equal(accepted.ok, true);
  const resultB = await promiseB;
  assert.equal(resultB.isError, false);
});

test("invalid arguments fail fast with a validation error result", async () => {
  const { tools } = loadModules();
  const bundle = tools.createAskUserQuestionTools({ conversationId: "conv-1" });
  const result = await bundle.executeToolCall(
    createToolCall({ questions: [{ prompt: "选项不足", options: [{ label: "唯一" }] }] }),
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /needs 2-6 options/);
  assert.deepEqual(result.details, {});
});

test("result details round-trip through the transcript parser", () => {
  const { shared } = loadModules();
  const questions = shared.parseAskUserQuestionItems(buildQuestionsArgs().questions);
  const answers = shared.resolveAskUserQuestionAnswers(questions, [
    { questionId: "storage", selectedLabel: "应用数据目录" },
    { questionId: "q2", selectedLabel: "不迁移" },
  ]);
  assert.ok(answers);

  const parsed = shared.parseAskUserQuestionResultDetails({
    kind: "ask_user_question",
    questions,
    answers,
  });
  assert.ok(parsed);
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.answers.length, 2);
  assert.equal(parsed.cancelled, false);

  assert.equal(shared.parseAskUserQuestionResultDetails({ kind: "todo_write" }), null);
  assert.equal(shared.parseAskUserQuestionResultDetails(null), null);
});
