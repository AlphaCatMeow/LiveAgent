import type { AssistantMessage, ToolCall, ToolResultMessage } from "@liveagent/app/lib/agentTypes";
import type { ComposerTurnCommand } from "@liveagent/ui/lib/chat/composerCommands";
import { appendMessagesToConversation } from "../../../lib/chat/conversation/conversationState";
import { buildConversationStateFromWindow } from "../../../lib/chat/history/chatHistory";
import {
  appendTextDeltaToRound,
  appendThinkingDeltaToRound,
  attachToolResultToRound,
  collapseThinking,
  type LiveRound,
  updateLiveRound,
  upsertHostedSearchToRound,
  upsertToolCallToRound,
} from "../../../lib/chat/messages/uiMessages";
import { createKBrainClient } from "../../../lib/kbrain/client";
import {
  assistantAwaitsUserInput,
  assistantDeclaresGoalMet,
  markGoalAwaitingInput,
  takeGoalAwaitingInput,
} from "../../../lib/kbrain/goalAwaitInput";
import { settleGoalAfterTurn } from "../../../lib/kbrain/goalSettle";
import {
  publishGoalState,
  readGoalState as readStoredGoalState,
} from "../../../lib/kbrain/goalStore";
import { getKBrainHistoryWindow } from "../../../lib/kbrain/history";
import { getKBrainSessionId } from "../../../lib/kbrain/mapping";
import { canonicalKBrainToolPolicies } from "../../../lib/kbrain/toolPolicies";
import { runKBrainTurn } from "../../../lib/kbrain/turn";
import type {
  KBrainGoalState,
  KBrainQuestionAnswer,
  KBrainQuestionRequest,
  KBrainRunOptions,
} from "../../../lib/kbrain/types";
import {
  resolveUploadStagingRoot,
  withUploadStagingRoot,
} from "../../../lib/kbrain/uploadStagingRoot";
import { requestBackendQuestion } from "../../../lib/tools/askUserQuestionTools";
import { projectBackendPlan } from "../../../lib/tools/planModeTools";
import { requestToolApproval } from "../../../lib/tools/toolApproval";
import type { RunAgentConversationTurnParams } from "./runAgentConversationTurn";
import type { RunTextConversationTurnParams } from "./runTextConversationTurn";

type Params = RunAgentConversationTurnParams | RunTextConversationTurnParams;

function canonicalRunOptions(params: Params, uploadsRoot?: string): KBrainRunOptions {
  const agentMode = "effectiveWorkdir" in params;
  const workspaceRoots = [
    {
      path: agentMode ? params.effectiveWorkdir : (params.conversationCwd ?? ""),
      access: "write" as const,
    },
    ...(agentMode
      ? (params.additionalRoots ?? []).map((root) => ({ path: root.path, access: root.access }))
      : []),
  ].filter((root) => root.path.trim());
  const roots = withUploadStagingRoot(workspaceRoots, uploadsRoot);
  const configured = agentMode ? params.getToolPolicies?.() : undefined;
  // Only policies for tools K-brain registers may be forwarded; a stale entry for a
  // frontend-only tool (e.g. Browser) would otherwise reject every run.
  const policies = canonicalKBrainToolPolicies(configured);
  const safety = agentMode && "commandSafetyMode" in params ? params.commandSafetyMode : undefined;
  const reasoning = params.runtime.reasoning;
  return {
    mode: agentMode ? "agent" : "chat",
    ...(reasoning ? { reasoning } : {}),
    search: params.runtime.nativeWebSearchEnabled === true ? "enabled" : "disabled",
    approval_policy: safety === "auto" ? "auto" : "ask",
    ...(roots.length ? { workspace_roots: roots } : {}),
    ...(Object.keys(policies).length ? { tools: { policies } } : {}),
    ...(agentMode && params.planModeEnabled !== undefined
      ? { plan_mode_enabled: params.planModeEnabled }
      : {}),
  };
}

function turnCommandParams(
  command: ComposerTurnCommand | undefined,
  attachClientRequestId: string | undefined,
) {
  if (attachClientRequestId) return { attachClientRequestId };
  if (command?.kind === "goal") {
    return {
      goal:
        command.action === "set"
          ? { action: "set" as const, goal: command.goal }
          : { action: "resume" as const },
    };
  }
  if (command?.kind === "prompt") return { promptCommand: true };
  return {};
}

/** 立即暂停目标，并把暂停后的状态推给目标栏；没有进行中的目标时后端回 409，忽略。 */
async function pauseGoalForInput(conversationId: string) {
  const sessionId = getKBrainSessionId(conversationId)?.trim();
  if (!sessionId) return;
  try {
    publishGoalState(
      conversationId,
      await createKBrainClient().postGoal(sessionId, { action: "pause" }),
    );
  } catch {
    // 409：目标已不在进行中；收尾时会再读一次目标状态。
  }
}

/**
 * 用户回复那一轮里模型已宣告完成：后端不判定普通运行，这里清掉暂停中的目标，
 * 再按“达成”通知界面，与后端判定达成时的提示一致（达成本来也会清掉目标）。
 */
async function completeGoalAfterReply(
  conversationId: string,
  notify: (state: KBrainGoalState) => void,
) {
  const sessionId = getKBrainSessionId(conversationId)?.trim();
  if (!sessionId) return;
  const goal = readStoredGoalState(conversationId)?.goal ?? "";
  try {
    const cleared = await createKBrainClient().postGoal(sessionId, { action: "clear" });
    notify({ ...cleared, status: "met", goal: goal || cleared.goal, reason: undefined });
  } catch {
    // 清除失败时目标停在暂停态，用户可在目标栏手动清除。
  }
}

/**
 * 最终回复文本：最后一个文字块。工具调用前说的话也会作为文字块排在前面，
 * 后端判定 GOAL_MET 只看最终回复，这里保持一致。
 */
function assistantText(message: AssistantMessage): string {
  const last = message.content.filter((block) => block.type === "text").at(-1);
  return last?.type === "text" ? last.text : "";
}

export async function runKBrainConversationTurn(params: Params): Promise<void> {
  let round = 1;
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
  cancellation.userStop.signal.addEventListener("abort", cancelApprovals, {
    once: true,
  });
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
  const projectToolResult = (call: ToolCall, result: ToolResultMessage) => {
    const prior = results.get(call.id);
    const enriched =
      prior?.details && !result.details ? { ...result, details: prior.details } : result;
    results.set(call.id, enriched);
    update((target) => ({
      ...attachToolResultToRound(target, call, enriched),
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
  const onToolResult = (call: ToolCall, result: ToolResultMessage) => {
    if (call.name === "ExitPlanMode" && !result.isError) {
      projectToolResult(call, {
        ...result,
        details: projectBackendPlan(params.conversationId, call),
      });
    } else projectToolResult(call, result);
  };
  hookLifecycle.startAgent();
  const explicitCommand = "composerCommand" in params ? params.composerCommand : undefined;
  // 目标因等待用户回复而暂停时，这条普通消息就是回复。后端的 goal resume 会把本轮
  // 内容换成固定的目标检查提示，回复会被丢掉；所以先把回复当普通消息发给模型，
  // 模型没有再次提问时再接一轮 goal resume。显式 /goal 指令自行决定目标去留。
  let resumeGoalAfterReply = takeGoalAwaitingInput(params.conversationId) && !explicitCommand;
  let command: ComposerTurnCommand | undefined = explicitCommand;
  const notifyGoal = (state: KBrainGoalState) => {
    if ("onGoalUpdate" in params && params.onGoalUpdate) params.onGoalUpdate(state);
    else publishGoalState(params.conversationId, state);
  };
  // 回复这一轮就是在推进目标：后端目标仍是暂停态，目标栏先按进行中显示；
  // 本轮结束后由完成、再次暂停或续接的 resume 给出真实状态。
  const pausedGoal = resumeGoalAfterReply ? readStoredGoalState(params.conversationId) : undefined;
  if (pausedGoal?.status === "paused") {
    publishGoalState(params.conversationId, { ...pausedGoal, status: "active", reason: undefined });
  }
  // 续接 goal resume 的那一轮用新的请求标识，不复用用户消息的标识。
  let followUpClientRequestId: string | undefined;
  // 目标续跑：后端在每轮终止前用 goal.updated 给出下一轮的请求标识，这里挂接上去，
  // 直到目标达成、暂停或用户停止。
  // 回调里写入、轮次结束后读取；经函数读取，避免控制流把它收窄成初始值。
  let latestGoalState: KBrainGoalState | undefined;
  // 本次发送是否牵涉目标（/goal 指令、续跑轮次或收到进行中的目标状态）；结束时据此对齐。
  let goalInvolved = command?.kind === "goal" || resumeGoalAfterReply;
  const readGoalState = () => latestGoalState;
  let attachClientRequestId: string | undefined;
  // 本轮回复在等用户回答，已暂停目标，不再挂接后端自动发起的下一轮。
  let pausedForInput = false;
  try {
    const uploadsRoot = await resolveUploadStagingRoot();
    for (;;) {
      hookLifecycle.startTurn(round);
      latestGoalState = undefined;
      const assistant = await runKBrainTurn({
        conversationId: params.conversationId,
        sessionId: params.sessionId,
        clientRequestId:
          attachClientRequestId ||
          followUpClientRequestId ||
          params.clientRequestId?.trim() ||
          params.trajectoryMessageId ||
          crypto.randomUUID(),
        turnId:
          !attachClientRequestId &&
          !followUpClientRequestId &&
          user &&
          "id" in user &&
          typeof user.id === "string"
            ? user.id
            : undefined,
        ...turnCommandParams(command, attachClientRequestId),
        onGoalUpdate: (state) => {
          latestGoalState = state;
          if (state.status === "active" || state.status === "continuing") goalInvolved = true;
          if ("onGoalUpdate" in params) params.onGoalUpdate?.(state);
        },
        cwd: params.conversationCwd,
        model: {
          provider: params.selectedModel.customProviderId || String(params.providerId),
          model: params.model,
        },
        prompt,
        context,
        options: canonicalRunOptions(params, uploadsRoot),
        signal: cancellation.userStop.signal,
        hook_policy: "backend",
        hook_scope_id: params.conversationId,
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
        onHostedSearch: (search) => {
          update((target) => upsertHostedSearchToRound(target, search));
        },
        onToolCall,
        onToolResult,
        onStatus: status,
        onQuestionRequest: async (
          request: KBrainQuestionRequest,
          signal?: AbortSignal,
        ): Promise<KBrainQuestionAnswer[]> => {
          const answers = await requestBackendQuestion({
            toolCallId: request.tool_call_id,
            conversationId: params.conversationId,
            questions: request.questions,
            deadlineAt: request.deadline_at,
            signal,
          });
          return answers.map((answer) => ({
            question_id: answer.questionId,
            selected_label: answer.selectedLabel,
            ...(answer.custom ? { custom: true } : {}),
          }));
        },
        onPermissionRequest: async (request) => {
          const settlement = await requestToolApproval({
            toolCallId: request.permission_id,
            toolName: request.tool,
            summary: [request.command, request.description].filter(Boolean).join("\n\n"),
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
              content: [
                {
                  type: "text",
                  text: subagent.error || subagent.report || subagent.status,
                },
              ],
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
      const completed = projected.stopReason === "stop" && !cancellation.userStop.signal.aborted;
      const awaitsInput = completed && assistantAwaitsUserInput(assistantText(projected));
      const goalState = readGoalState();
      // 后端在本轮结束后立刻自行发起下一轮，暂停必须赶在刷新历史之前发出；
      // 下一轮已开始时暂停会把它取消。
      if (awaitsInput && goalState?.status === "continuing") {
        pausedForInput = true;
        markGoalAwaitingInput(params.conversationId);
        await pauseGoalForInput(params.conversationId);
      }
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
      const nextRound =
        completed && !pausedForInput && goalState?.status === "continuing" ? goalState : undefined;
      if (resumeGoalAfterReply) {
        resumeGoalAfterReply = false;
        if (awaitsInput) {
          // 模型拿到回复后仍在提问：目标保持暂停，继续等用户。
          markGoalAwaitingInput(params.conversationId);
        } else if (completed && assistantDeclaresGoalMet(assistantText(projected))) {
          // 模型拿到回复后已完成目标：不再续跑，清掉暂停中的目标。
          await completeGoalAfterReply(params.conversationId, notifyGoal);
        } else if (completed) {
          // 回复已交给模型，接一轮 goal resume 回到目标续跑。
          params.settleLiveTranscript(transcriptStore);
          params.applyConversationState(
            appendMessagesToConversation(state, [
              { role: "user", content: "/goal resume", timestamp: Date.now() },
            ]),
          );
          hookLifecycle.ensureMessageEnded();
          hookLifecycle.endTurn(round);
          round += 1;
          results.clear();
          calls.clear();
          command = { kind: "goal", action: "resume" };
          followUpClientRequestId = crypto.randomUUID();
          continue;
        }
      }
      if (nextRound?.next_client_request_id) {
        // 把刚完成的一轮落进转录区，并先显示后端为下一轮写入的用户消息。
        params.settleLiveTranscript(transcriptStore);
        params.applyConversationState(
          appendMessagesToConversation(state, [
            { role: "user", content: nextRound.next_prompt ?? "", timestamp: Date.now() },
          ]),
        );
        hookLifecycle.ensureMessageEnded();
        hookLifecycle.endTurn(round);
        round += 1;
        results.clear();
        calls.clear();
        command = undefined;
        attachClientRequestId = nextRound.next_client_request_id;
        continue;
      }
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
      break;
    }
  } finally {
    if (goalInvolved) {
      void settleGoalAfterTurn({
        client: createKBrainClient(),
        conversationId: params.conversationId,
        sessionId: getKBrainSessionId(params.conversationId),
        stopped: cancellation.userStop.signal.aborted,
        publish: publishGoalState,
      });
    }
    approvalController.abort();
    cancellation.userStop.signal.removeEventListener("abort", cancelApprovals);
    status(null);
    hookLifecycle.ensureMessageEnded();
    hookLifecycle.endTurn(round);
    hookLifecycle.endAgent();
  }
}
