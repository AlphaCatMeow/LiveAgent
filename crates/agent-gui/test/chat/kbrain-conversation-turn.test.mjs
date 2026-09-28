import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { runTextConversationTurn } = loader.loadModule("src/pages/chat/turns/runTextConversationTurn.ts");
const { runAgentConversationTurn } = loader.loadModule("src/pages/chat/turns/runAgentConversationTurn.ts");
const { createConversationStateFromContext } = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
const approval = loader.loadModule("src/lib/tools/toolApproval.ts");
const { buildUiMessages } = loader.loadModule("src/lib/chat/messages/uiMessages.ts");

for (const [mode, runTurn, decision, expectedDecision] of [
  ["text", runTextConversationTurn, "approve", "allow_once"],
  ["agent", runAgentConversationTurn, "approve", "allow_once"],
  ["agent-deny", runAgentConversationTurn, "deny", "reject"],
  ["agent-session", runAgentConversationTurn, "approve_session", "allow_always"],
  ["agent-failed", runAgentConversationTurn, "approve", "allow_once"],
  ["agent-refresh-failed", runAgentConversationTurn, "approve", "allow_once"],
]) {
  test(`${mode} shipped turn uses K-brain HTTP, renders tools, and resolves the UI approval`, async (t) => {
    const requests = [];
    let stream;
    let sequence = 0;
    const event = (type, payload) => stream.write(`data: ${JSON.stringify({
      version: "kbrain.agent.v1", seq: ++sequence, conversation_id: "session", run_id: "run", type,
      created_at: new Date().toISOString(), payload,
    })}\n\n`);
    const server = http.createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      requests.push({ path: request.url, body: body ? JSON.parse(body) : undefined });
      const json = (value, code = 200) => {
        response.writeHead(code, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/v1/sessions") return json({ id: "session" }, 201);
      if (request.url === "/v1/sessions/session/runs") return json({ version: "kbrain.agent.v1", conversation_id: "session", run_id: "run", accepted_seq: 1 }, 202);
      if (request.url === "/v1/sessions/session" || request.url.startsWith("/v1/sessions/session/history")) {
        if (mode === "agent-refresh-failed") return json({ error: "history temporarily unavailable" }, 503);
        const messages = [
          { id: "user-persisted", role: "user", content: [{ type: "text", text: "inspect" }] },
          { id: "assistant-persisted", role: "assistant", content: [{ type: "text", text: "Hello" }], tool_calls: [{ id: "call", name: "read_file", arguments: { path: "README.md" } }] },
          { id: "tool-persisted", role: "tool", tool_call_id: "call", name: "read_file", content: [{ type: "text", text: expectedDecision === "reject" ? "permission rejected" : "file contents" }], stop_reason: expectedDecision === "reject" ? "error" : "stop" },
        ];
        const session = { id: "session", revision: "saved-revision", title: "Inspect", model: { provider: "fixture", model: "model" }, created_at: "2026-09-28T00:00:00Z", updated_at: "2026-09-28T00:00:01Z", message_count: messages.length, last_seq: sequence, messages,
          tasks: [{ id: "child", description: "Review", status: "done", model: { provider: "fixture", model: "model" }, report: "Reviewed" }] };
        return json(request.url.includes("/history") ? { session, revision: session.revision, oldest_offset: 0, has_more_before: false, total_message_count: messages.length, active_messages: messages } : session);
      }
      if (request.url.startsWith("/v1/sessions/session/events")) {
        stream = response;
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        sequence = Number(new URL(request.url, "http://localhost").searchParams.get("after_seq") ?? 0);
        event("user.message.appended", { role: "user", content: [{ type: "text", text: "inspect" }] });
        event("assistant.thinking.delta", { text: "Checking" });
        event("assistant.text.delta", { text: "Hello" });
        event("tool.call", { tool_call: { id: "call", name: "read_file", arguments: { path: "README.md" } } });
        event("permission.requested", { permission_id: "permission", tool: "read_file", command: "README.md" });
        return;
      }
      if (request.url === "/v1/sessions/session/permissions/permission") {
        assert.equal(JSON.parse(body).decision.decision, expectedDecision);
        json({ ok: true });
        event("permission.resolved", { permission_id: "permission", decision: expectedDecision });
        event("tool.result", { tool_result: { id: "call", name: "read_file", output: expectedDecision === "reject" ? "permission rejected" : "file contents", failed: expectedDecision === "reject" } });
        event("subagent.completed", { subagent: { id: "child", description: "Review", status: "done", model: { provider: "fixture", model: "model" }, report: "Reviewed" } });
        event("assistant.message.created", { role: "assistant", content: [{ type: "text", text: "Hello" }], usage: { input_tokens: 7, output_tokens: 2 } });
        if (mode === "agent-failed") event("run.failed", { state: "failed", error: "fixture upstream unavailable" });
        else event("run.completed", { state: "completed" });
        stream.end();
        return;
      }
      json({ error: `Unexpected path ${request.url}` }, 404);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const originalFetch = globalThis.fetch;
    const originalStorage = globalThis.localStorage;
    const origin = `http://127.0.0.1:${server.address().port}`;
    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
      key: (index) => Array.from(storage.keys())[index] ?? null,
      get length() { return storage.size; },
    };
    globalThis.fetch = (url, init) => {
      assert.equal(new URL(url).origin, "http://127.0.0.1:47321");
      return originalFetch(`${origin}${new URL(url).pathname}${new URL(url).search}`, init);
    };
    t.after(() => {
      globalThis.fetch = originalFetch;
      if (originalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = originalStorage;
      server.closeAllConnections();
      server.close();
    });
    const conversationId = `conversation-${mode}`;
    const dispose = approval.subscribeToolApprovalsForConversation(conversationId, () => {
      for (const pending of approval.listPendingToolApprovalsForConversation(conversationId)) {
        approval.answerToolApproval(pending.toolCallId, decision, { conversationId });
      }
    });
    t.after(dispose);
    const context = { systemPrompt: "system", messages: [{ role: "user", content: [{ type: "text", text: "inspect" }], timestamp: 1 }] };
    let state = createConversationStateFromContext(context);
    let rounds = [];
    let persisted;
    const hooks = [];
    const errors = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    t.after(() => clearTimeout(timeout));
    await runTurn({
      providerId: "codex", model: "model", selectedModel: { customProviderId: "fixture", model: "model" },
      runtime: { backend: "kbrain" }, sessionId: "frontend-session", conversationId,
      trajectoryMessageId: `message-${mode}`, conversationCwd: "/workspace", createdAt: 1, fallbackTitle: "Inspect", titlePromise: null,
      transcriptStore: {}, cancellation: { userStop: controller },
      gatewayBridgeEvents: { queueToken() {}, queueEvent() {}, queueToolStatus() {}, emitError(message) { errors.push(message); } },
      hookLifecycle: Object.fromEntries(["startAgent", "startTurn", "ensureMessageEnded", "endTurn", "endAgent"].map((key) => [key, () => hooks.push(key)])),
      buildPreparedContext: () => context, getNextConversationState: () => state,
      applyConversationState: (value) => { state = value; },
      batchLiveRoundsUpdate: (update) => { rounds = update(rounds); },
      updateToolStatus() {}, updateGatewayBridgeToolStatus() {}, freezeGatewayFinalProjection() {}, settleLiveTranscript() {},
      persistConversationWithHistorySync: async (value) => { persisted = value; return true; },
    });
    assert.equal(requests.find((request) => request.path.endsWith("/runs")).body.prompt, "inspect");
    assert.equal(requests.find((request) => request.path.endsWith("/runs")).body.model.provider, "fixture");
    assert.equal(rounds[0].blocks.find((block) => block.kind === "text").text, "Hello");
    assert.equal(rounds[0].blocks.find((block) => block.kind === "thinking").text, "Checking");
    const expectedOutput = expectedDecision === "reject" ? "permission rejected" : "file contents";
    const toolResult = rounds[0].blocks.find((block) => block.kind === "tool" && block.item.toolCall.id === "call").item.toolResult;
    assert.equal(toolResult.content[0].text, expectedOutput);
    assert.equal(toolResult.isError, expectedDecision === "reject");
    assert.equal(rounds[0].blocks.find((block) => block.kind === "tool" && block.item.toolCall.id === "kbrain-subagent:child").item.toolResult.content[0].text, "Reviewed");
    const messages = persisted.state.segments.flatMap((segment) => segment.messages);
    if (mode === "agent-refresh-failed") {
      assert.equal(errors.length, 1);
      assert.match(errors[0], /Reply completed, but history refresh failed:.*history temporarily unavailable/);
      assert.equal(requests.filter((request) => request.path.endsWith("/runs")).length, 1);
    } else {
      assert.deepEqual(errors, mode === "agent-failed" ? ["fixture upstream unavailable"] : []);
      if (mode !== "agent-failed") assert.equal(messages.find((message) => message.role === "user").id, "user-persisted");
    }
    assert.equal(messages.find((message) => message.role === "assistant").stopReason, mode === "agent-failed" ? "error" : "stop");
    assert.ok(messages.some((message) => message.role === "toolResult" && message.toolCallId === "call"));
    assert.ok(messages.some((message) => message.role === "assistant" && message.content.some((block) => block.type === "toolCall" && block.id === "call")));
    const restored = buildUiMessages(messages);
    const restoredTools = restored.flatMap((message) => message.rounds ?? []).flatMap((round) => round.blocks).filter((block) => block.kind === "tool");
    assert.ok(restoredTools.some((block) => block.item.toolCall.id === "call" && block.item.toolResult.content[0].text === expectedOutput && block.item.toolResult.isError === (expectedDecision === "reject")));
    assert.ok(restoredTools.some((block) => block.item.toolCall.id === "kbrain-subagent:child" && block.item.toolResult.content[0].text === "Reviewed"));
    assert.deepEqual(hooks, ["startAgent", "startTurn", "ensureMessageEnded", "endTurn", "endAgent"]);
    assert.equal(approval.listPendingToolApprovalsForConversation(conversationId).length, 0);
  });
}
