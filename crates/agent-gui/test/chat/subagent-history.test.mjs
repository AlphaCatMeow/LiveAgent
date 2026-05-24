import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { collectRetainedSubagentParentToolCallIds } = loader.loadModule(
  "src/lib/chat/subagent/subagentHistory.ts",
);
const { renderSubagentMessageBusSnapshot } = loader.loadModule(
  "src/lib/chat/subagent/subagentMessageBus.ts",
);

function stateWithMessages(messages) {
  return {
    meta: {
      schemaVersion: 3,
      activeSegmentIndex: 0,
      totalSegmentCount: 1,
      totalMessageCount: messages.length,
    },
    activeSegmentIndex: 0,
    historyRenderItems: [],
    segments: [
      {
        segmentIndex: 0,
        segmentId: "segment-1",
        messages,
        messageCount: messages.length,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  };
}

test("subagent history rollback keeps retained Agent and SendMessage parent tool call ids", () => {
  const keep = collectRetainedSubagentParentToolCallIds(
    stateWithMessages([
      {
        role: "toolResult",
        toolName: "Agent",
        toolCallId: " call-agent-a ",
        content: [{ type: "text", text: "agent a" }],
        details: { kind: "delegate_agent" },
        isError: false,
      },
      {
        role: "toolResult",
        toolName: "Read",
        toolCallId: "call-read",
        content: [{ type: "text", text: "file" }],
        details: {},
        isError: false,
      },
      {
        role: "toolResult",
        toolName: "Agent",
        toolCallId: "call-agent-a",
        content: [{ type: "text", text: "duplicate agent a" }],
        details: { kind: "delegate_agent" },
        isError: false,
      },
      {
        role: "toolResult",
        toolName: "SendMessage",
        toolCallId: " call-send-a ",
        content: [{ type: "text", text: "message sent" }],
        details: { kind: "subagent_message" },
        isError: false,
      },
      {
        role: "toolResult",
        toolName: "Agent",
        toolCallId: "call-agent-b",
        content: [{ type: "text", text: "agent b" }],
        details: { kind: "delegate_agent" },
        isError: false,
      },
    ]),
  );

  assert.deepEqual(keep, ["call-agent-a", "call-send-a", "call-agent-b"]);
});

test("subagent run persistence stores compact reconstructable context metadata", async () => {
  let capturedInput = null;
  const localLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          assert.equal(command, "subagent_run_upsert");
          capturedInput = args.input;
        },
      },
    },
  });
  const { persistSubagentRunState } = localLoader.loadModule(
    "src/lib/chat/subagent/subagentHistory.ts",
  );

  await persistSubagentRunState({
    id: "run-1",
    parentConversationId: "conversation-1",
    parentToolCallId: "call-agent",
    parentToolName: "Agent",
    agentIndex: 0,
    agentTotal: 1,
    logicalAgentId: "agent-a",
    description: "Agent A",
    mode: "readonly",
    status: "running",
    providerId: "codex",
    model: "gpt-5",
    state: {
      ...stateWithMessages([{ role: "user", content: "hello", timestamp: 1 }]),
      meta: {
        schemaVersion: 3,
        systemPrompt: "large prompt",
        tools: [{ name: "Read", description: "Read", parameters: {} }],
        activeSegmentIndex: 0,
        totalSegmentCount: 1,
        totalMessageCount: 1,
      },
    },
    roundCount: 0,
    toolCallCount: 0,
    compactionCount: 0,
    startedAt: 1,
  });

  assert.ok(capturedInput);
  const meta = JSON.parse(capturedInput.contextMetaJson);
  assert.deepEqual(meta, {
    schemaVersion: 3,
    activeSegmentIndex: 0,
    totalSegmentCount: 1,
    totalMessageCount: 1,
  });
});

test("subagent message append normalizes wire input", async () => {
  let captured = null;
  const localLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          assert.equal(command, "subagent_message_append");
          captured = args.input;
          return {
            id: 1,
            seq: 1,
            ...args.input,
          };
        },
      },
    },
  });
  const { appendSubagentMessage } = localLoader.loadModule(
    "src/lib/chat/subagent/subagentHistory.ts",
  );

  const record = await appendSubagentMessage({
    parentConversationId: " conversation-1 ",
    senderAgentId: " agent-a ",
    senderDisplayName: " Agent A ",
    recipientAgentId: " parent ",
    recipientDisplayName: " Parent Agent ",
    channel: "direct",
    subject: " Scope ",
    bodyMarkdown: " **hello** ",
    sourceRunId: " run-a ",
    sourceToolCallId: " call-send ",
    createdAt: 10,
  });

  assert.ok(record);
  assert.equal(captured.parentConversationId, "conversation-1");
  assert.equal(captured.senderAgentId, "agent-a");
  assert.equal(captured.senderDisplayName, "Agent A");
  assert.equal(captured.recipientAgentId, "parent");
  assert.equal(captured.bodyMarkdown, "**hello**");
  assert.equal(captured.sourceRunId, "run-a");
  assert.equal(record.seq, 1);
});

test("subagent message bus snapshot renders only Markdown sections for current inbox", () => {
  const snapshot = renderSubagentMessageBusSnapshot({
    currentAgentId: "parent",
    currentAgentName: "Parent Agent",
    messages: [
      {
        id: 1,
        parentConversationId: "conversation-1",
        seq: 1,
        senderAgentId: "agent-a",
        senderDisplayName: "Agent A",
        recipientAgentId: "parent",
        recipientDisplayName: "Parent Agent",
        channel: "question",
        subject: "Clarify scope",
        bodyMarkdown: "Should we include WebUI parity?",
        createdAt: 1_700_000_000_000,
      },
      {
        id: 2,
        parentConversationId: "conversation-1",
        seq: 2,
        senderAgentId: "parent",
        senderDisplayName: "Parent Agent",
        recipientAgentId: "*",
        recipientDisplayName: "All Agents",
        channel: "decision",
        subject: "Scope",
        bodyMarkdown: "Keep the bus snapshot Markdown-only.",
        createdAt: 1_700_000_000_100,
      },
      {
        id: 3,
        parentConversationId: "conversation-1",
        seq: 3,
        senderAgentId: "agent-b",
        senderDisplayName: "Agent B",
        recipientAgentId: "agent-c",
        channel: "direct",
        bodyMarkdown: "Private note.",
        createdAt: 1_700_000_000_200,
      },
    ],
  });

  assert.match(snapshot, /## LiveAgent Message Bus/);
  assert.match(snapshot, /### Direct Inbox for Parent Agent/);
  assert.match(snapshot, /### Shared Decisions/);
  assert.match(snapshot, /Should we include WebUI parity/);
  assert.match(snapshot, /Keep the bus snapshot Markdown-only/);
  assert.doesNotMatch(snapshot, /Private note/);
});

test("subagent message bus snapshot applies maxMessages as a global window", () => {
  const snapshot = renderSubagentMessageBusSnapshot({
    currentAgentId: "parent",
    currentAgentName: "Parent Agent",
    maxMessages: 2,
    messages: [
      {
        id: 1,
        parentConversationId: "conversation-1",
        seq: 1,
        senderAgentId: "agent-a",
        recipientAgentId: "parent",
        channel: "question",
        subject: "One",
        bodyMarkdown: "First direct question.",
        createdAt: 1,
      },
      {
        id: 2,
        parentConversationId: "conversation-1",
        seq: 2,
        senderAgentId: "parent",
        recipientAgentId: "*",
        channel: "decision",
        subject: "Decision",
        bodyMarkdown: "Shared decision.",
        createdAt: 2,
      },
      {
        id: 3,
        parentConversationId: "conversation-1",
        seq: 3,
        senderAgentId: "parent",
        recipientAgentId: "agent-c",
        channel: "direct",
        subject: "Recent",
        bodyMarkdown: "Parent sent recent direct.",
        createdAt: 3,
      },
    ],
  });

  assert.match(snapshot, /First direct question/);
  assert.match(snapshot, /Shared decision/);
  assert.doesNotMatch(snapshot, /Parent sent recent direct/);
});

test("subagent message bus snapshot does not treat shared channel as broadcast without to=*", () => {
  const snapshot = renderSubagentMessageBusSnapshot({
    currentAgentId: "agent-b",
    currentAgentName: "Agent B",
    messages: [
      {
        id: 1,
        parentConversationId: "conversation-1",
        seq: 1,
        senderAgentId: "agent-a",
        recipientAgentId: "parent",
        channel: "shared",
        subject: "Parent-only",
        bodyMarkdown: "This legacy-shaped parent message must stay private.",
        createdAt: 1,
      },
      {
        id: 2,
        parentConversationId: "conversation-1",
        seq: 2,
        senderAgentId: "agent-a",
        recipientAgentId: "*",
        channel: "shared",
        subject: "Broadcast",
        bodyMarkdown: "This broadcast is visible.",
        createdAt: 2,
      },
    ],
  });

  assert.match(snapshot, /This broadcast is visible/);
  assert.doesNotMatch(snapshot, /This legacy-shaped parent message must stay private/);
});
