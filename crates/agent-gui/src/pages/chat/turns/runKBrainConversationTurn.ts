import type { AssistantMessage, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { appendMessagesToConversation } from "../../../lib/chat/conversation/conversationState";
import { buildConversationStateFromWindow } from "../../../lib/chat/history/chatHistory";
import {
  appendTextDeltaToRound,
  appendThinkingDeltaToRound,
  attachToolResultToRound,
  collapseThinking,
  type LiveRound,
  updateLiveRound,
  upsertToolCallToRound,
} from "../../../lib/chat/messages/uiMessages";
import { getKBrainHistoryWindow } from "../../../lib/kbrain/history";
import { runKBrainTurn } from "../../../lib/kbrain/turn";
import { requestToolApproval } from "../../../lib/tools/toolApproval";
import type { RunAgentConversationTurnParams } from "./runAgentConversationTurn";
import type { RunTextConversationTurnParams } from "./runTextConversationTurn";

type Params = RunAgentConversationTurnParams | RunTextConversationTurnParams;

export async function runKBrainConversationTurn(params: Params): Promise<void> {
  const round = 1;
  const { transcriptStore, gatewayBridgeEvents, hookLifecycle, cancellation } = params;
  const context = params.buildPreparedContext(params.getNextConversationState(), undefined, {
    includeUploadedFilesMetadata: true,
  });
  const user = context.messages.filter((message) => message.role === "user").at(-1);
  const prompt =
    typeof user?.content === "string"
      ? user.content
      : (user?.content ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
  const results = new Map<string, ToolResultMessage>();
  const calls = new Map<string, ToolCall>();
  const approvalController = new AbortController();
  const cancelApprovals = () => approvalController.abort();
  cancellation.userStop.signal.addEventListener("abort", cancelApprovals, { once: true });
  const update = (apply: (round: LiveRound) => LiveRound) => {
    params.batchLiveRoundsUpdate((previous) => {
      const rounds = previous.some((item) => item.round === round)
        ? previous
        : [
            ...previous,
            {
              key: `r${round}`,
              round,
              blocks: [],
              runningToolCallIds: [],
              thinkingOpen: false,
            },
          ];
      return updateLiveRound(rounds, round, apply);
    }, transcriptStore);
  };
  const status = (value: string | null) => {
    if ("updateGatewayBridgeToolStatus" in params) params.updateGatewayBridgeToolStatus(value);
    else {
      params.updateToolStatus(value, transcriptStore);
      gatewayBridgeEvents.queueToolStatus(value);
    }
  };
  const onToolCall = (call: ToolCall) => {
    calls.set(call.id, call);
    update((target) => ({
      ...upsertToolCallToRound(collapseThinking(target), call),
      runningToolCallIds: [...new Set([...target.runningToolCallIds, call.id])],
    }));
    gatewayBridgeEvents.queueEvent({
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      conversation_id: params.conversationId,
      round,
    });
  };
  const onToolResult = (call: ToolCall, result: ToolResultMessage) => {
    results.set(call.id, result);
    update((target) => ({
      ...attachToolResultToRound(target, call, result),
      runningToolCallIds: target.runningToolCallIds.filter((id) => id !== call.id),
    }));
    gatewayBridgeEvents.queueEvent({
      type: "tool_result",
      id: call.id,
      name: call.name,
      result: result.content,
      conversation_id: params.conversationId,
      round,
    });
  };
  hookLifecycle.startAgent();
  hookLifecycle.startTurn(round);
  try {
    const assistant = await runKBrainTurn({
      conversationId: params.conversationId,
      sessionId: params.sessionId,
      clientRequestId: params.trajectoryMessageId ?? crypto.randomUUID(),
      cwd: params.conversationCwd,
      model: {
        provider: params.selectedModel.customProviderId || String(params.providerId),
        model: params.model,
      },
      prompt,
      context,
      signal: cancellation.userStop.signal,
      baseUrl: import.meta.env?.VITE_KBRAIN_URL,
      token: import.meta.env?.VITE_KBRAIN_TOKEN,
      onTextDelta: (delta) => {
        update((target) => appendTextDeltaToRound(collapseThinking(target), delta));
        gatewayBridgeEvents.queueToken(delta, { round });
      },
      onThinkingDelta: (delta) => {
        update((target) => appendThinkingDeltaToRound(target, delta));
        gatewayBridgeEvents.queueEvent({
          type: "thinking",
          text: delta,
          round,
          conversation_id: params.conversationId,
        });
      },
      onToolCall,
      onToolResult,
      onStatus: status,
      onPermissionRequest: async (request) => {
        const settlement = await requestToolApproval({
          toolCallId: request.permission_id,
          toolName: request.tool,
          summary: request.command ?? request.description,
          conversationId: params.conversationId,
          signal: approvalController.signal,
        });
        if (settlement.kind !== "decided" || settlement.decision === "deny") return "reject";
        return settlement.decision === "approve_session" ? "allow_always" : "allow_once";
      },
      onSubagent: (subagent) => {
        const id = `kbrain-subagent:${subagent.id}`;
        const call: ToolCall = {
          type: "toolCall",
          id,
          name: "subagent",
          arguments: {
            id: subagent.id,
            description: subagent.description,
            status: subagent.status,
            model: subagent.model,
          },
        };
        onToolCall(call);
        if (["done", "completed", "error", "failed", "cancelled"].includes(subagent.status)) {
          onToolResult(call, {
            role: "toolResult",
            toolCallId: id,
            toolName: call.name,
            content: [{ type: "text", text: subagent.error || subagent.report || subagent.status }],
            isError: !["done", "completed"].includes(subagent.status),
            timestamp: Date.now(),
          });
        }
      },
    });
    const assistantCallIds = new Set(
      assistant.content.filter((block) => block.type === "toolCall").map((block) => block.id),
    );
    const projected: AssistantMessage = {
      ...assistant,
      content: [
        ...assistant.content,
        ...Array.from(calls.values()).filter((call) => !assistantCallIds.has(call.id)),
      ],
    };
    update((target) => ({
      ...collapseThinking(target),
      runningToolCallIds: [],
      meta: {
        provider: projected.provider,
        model: projected.model,
        api: projected.api,
        stopReason: projected.stopReason,
        usage: projected.usage,
      },
    }));
    gatewayBridgeEvents.queueToken("", {
      round,
      provider: projected.provider,
      model: projected.model,
      api: projected.api,
      stopReason: projected.stopReason,
      usage: projected.usage,
    });
    if (projected.errorMessage) gatewayBridgeEvents.emitError(projected.errorMessage);
    let state = appendMessagesToConversation(params.getNextConversationState(), [
      projected,
      ...results.values(),
    ]);
    if (projected.stopReason !== "error" && projected.stopReason !== "aborted") {
      try {
        const history = await getKBrainHistoryWindow(params.conversationId);
        state = buildConversationStateFromWindow(history);
      } catch (error) {
        gatewayBridgeEvents.emitError(
          `Reply completed, but history refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    params.applyConversationState(state);
    params.freezeGatewayFinalProjection(state, true);
    params.settleLiveTranscript(transcriptStore);
    await params.persistConversationWithHistorySync({
      conversationId: params.conversationId,
      sessionId: params.sessionId,
      providerId: projected.provider,
      model: projected.model,
      cwd: "historyCwd" in params ? params.historyCwd : params.conversationCwd,
      state,
      fallbackTitle: params.fallbackTitle,
      createdAt: params.createdAt,
      titlePromise: params.titlePromise,
    });
  } finally {
    approvalController.abort();
    cancellation.userStop.signal.removeEventListener("abort", cancelApprovals);
    status(null);
    hookLifecycle.ensureMessageEnded();
    hookLifecycle.endTurn(round);
    hookLifecycle.endAgent();
  }
}
