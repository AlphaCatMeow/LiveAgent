import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const chatAbort = loader.loadModule("src/lib/chat/conversation/chatAbort.ts");
const conversationState = loader.loadModule("src/lib/chat/conversation/conversationState.ts");

function user(content, timestamp) {
  return { role: "user", content, timestamp };
}

function toolCall(id, name = "Read", args = { path: "foo.txt" }) {
  return {
    type: "toolCall",
    id,
    name,
    arguments: args,
  };
}

function toolResult(id, name = "Read", text = "ok", timestamp = 3) {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    details: { ok: true },
    isError: false,
    timestamp,
  };
}

test("persistable cancelled snapshot strips incomplete tool artifacts but keeps visible text", () => {
  const messages = chatAbort.buildPersistableMessagesFromSnapshot({
    executionMode: "agent",
    model: {
      api: "openai-responses",
      provider: "openai",
      id: "gpt-5",
    },
    draftAssistantText: "",
    liveRounds: [
      {
        round: 1,
        blocks: [
          { kind: "text", text: "先看看这个文件。" },
          {
            kind: "tool",
            item: {
              toolCall: toolCall("call-1"),
              toolResult: toolResult("call-1"),
            },
          },
        ],
      },
    ],
    timestamp: 10,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].stopReason, "aborted");
  assert.deepEqual(messages[0].content, [{ type: "text", text: "先看看这个文件。" }]);
});

test("persistable cancelled snapshot keeps visible provider hosted search blocks", () => {
  const hostedSearch = {
    type: "hostedSearch",
    id: "search-1",
    provider: "codex",
    status: "searching",
    queries: ["LiveAgent web search"],
    sources: [],
  };
  const messages = chatAbort.buildPersistableMessagesFromSnapshot({
    executionMode: "text",
    model: {
      api: "openai-responses",
      provider: "openai",
      id: "gpt-5",
    },
    draftAssistantText: "",
    liveRounds: [
      {
        round: 1,
        blocks: [{ kind: "hostedSearch", item: hostedSearch }],
      },
    ],
    timestamp: 10,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].stopReason, "aborted");
  assert.deepEqual(messages[0].content, [hostedSearch]);
});

test("continuation request context skips cancelled rounds by default but can include them explicitly", () => {
  const state = conversationState.createConversationStateFromContext({
    messages: [
      user("先读取文件", 1),
      {
        role: "assistant",
        content: [
          { type: "text", text: "我先读一下。" },
          toolCall("call-1"),
        ],
        stopReason: "aborted",
        timestamp: 2,
      },
      toolResult("call-1", "Read", "partial tool output", 3),
      user("继续", 4),
    ],
  });

  const requestContext = conversationState.buildRequestContext(state);
  assert.deepEqual(
    requestContext.messages.map((message) => message.role),
    ["user", "user"],
  );
  assert.deepEqual(
    requestContext.messages.map((message) => message.content),
    ["先读取文件", "继续"],
  );

  const rawContext = conversationState.buildRequestContext(state, {
    includeAbortedMessages: true,
  });
  assert.deepEqual(
    rawContext.messages.map((message) => message.role),
    ["user", "assistant", "toolResult", "user"],
  );
  assert.equal(rawContext.messages[1].content[1].type, "toolCall");
});
