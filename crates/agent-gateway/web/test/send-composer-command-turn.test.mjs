import assert from "node:assert/strict";
import test from "node:test";
import { createWebModuleLoader } from "../../test/helpers/load-web-module.mjs";

// WebUI 的“/”指令发送：指令语义映射成聊天请求字段；未被接受时抛错，输入框据此保留草稿。
const loader = createWebModuleLoader();
const { sendComposerCommandTurn } = loader.loadModule("src/app/sendComposerCommandTurn.ts");
const t = (key) => key;

test("goal and prompt commands map onto chat request fields for the target conversation", async () => {
  const calls = [];
  const sendChat = async (text, options) => {
    calls.push([text, options]);
    return { kind: "accepted", accepted: { conversationId: "c1" } };
  };
  await sendComposerCommandTurn(sendChat, t, "/goal ship", { kind: "goal", action: "set", goal: "ship" }, { conversationId: "c1" });
  await sendComposerCommandTurn(sendChat, t, "/review", { kind: "prompt" });
  assert.equal(calls[0][1].conversationId, "c1");
  assert.equal(calls[0][1].goalAction, "set");
  assert.equal(calls[0][1].goalText, "ship");
  assert.equal(calls[1][1].promptCommand, true);
  assert.equal(calls[1][1].conversationId, undefined);
});

test("a send that is not accepted throws instead of silently dropping the command", async () => {
  await assert.rejects(sendComposerCommandTurn(async () => null, t, "/review", { kind: "prompt" }), /chat\.commands\.busy/);
  await assert.rejects(
    sendComposerCommandTurn(async () => ({ kind: "failed", errorCode: null, message: "offline" }), t, "/review", { kind: "prompt" }),
    /offline/,
  );
});
