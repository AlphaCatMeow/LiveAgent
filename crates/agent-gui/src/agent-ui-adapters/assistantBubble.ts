import type { AskUserQuestionAnswer } from "@liveagent/ui/lib/chat/askUserQuestion";
import type { PlanDecisionAnswer } from "@liveagent/ui/lib/chat/planMode";
import type {
  ToolRootRequest,
  ToolRootRequestAnswerer,
} from "@liveagent/ui/lib/chat/toolRootRequest";
import { useSyncExternalStore } from "react";
import {
  answerAskUserQuestion,
  getAskUserQuestionDeadlineAt,
} from "../lib/tools/askUserQuestionTools";
import {
  answerPlanDecision,
  getPlanDecisionVersion,
  isPlanApprovalToolCall,
  isPlanDecisionPending,
  subscribePlanDecisions,
} from "../lib/tools/planModeTools";
import {
  answerRootRequest,
  getPendingRootRequest,
  getRootRequestVersion,
  subscribeRootRequests,
} from "../lib/tools/rootRequests";
import {
  getPendingToolApproval,
  getToolApprovalVersion,
  subscribeToolApprovals,
} from "../lib/tools/toolApproval";

export const deferLargeToolImages = false;
export const retainRunningToolContent = true;

export function usePendingToolApproval(
  toolCallId: string,
  _toolArguments: Record<string, unknown>,
) {
  useSyncExternalStore(subscribeToolApprovals, getToolApprovalVersion, getToolApprovalVersion);
  return Boolean(getPendingToolApproval(toolCallId));
}

export function readAskUserQuestionDeadline(
  toolCallId: string,
  _toolArguments: Record<string, unknown>,
) {
  return getAskUserQuestionDeadlineAt(toolCallId) ?? undefined;
}

export function submitAskUserQuestionAnswers(toolCallId: string, answers: AskUserQuestionAnswer[]) {
  return Promise.resolve(answerAskUserQuestion(toolCallId, answers));
}

export function usePlanDecisionState(toolCallId: string, _toolArguments: Record<string, unknown>) {
  useSyncExternalStore(subscribePlanDecisions, getPlanDecisionVersion, getPlanDecisionVersion);
  return {
    pending: isPlanDecisionPending(toolCallId),
    approved: isPlanApprovalToolCall(toolCallId),
  };
}

export function submitPlanDecision(toolCallId: string, answer: PlanDecisionAnswer) {
  return Promise.resolve(answerPlanDecision(toolCallId, answer));
}

/** A tool call paused on a denied path, waiting for the user's grant. */
export function usePendingRootRequest(toolCallId: string): ToolRootRequest | null {
  useSyncExternalStore(subscribeRootRequests, getRootRequestVersion, getRootRequestVersion);
  return getPendingRootRequest(toolCallId);
}

export function useHasPendingRootRequest(toolCallIds: readonly string[]): boolean {
  useSyncExternalStore(subscribeRootRequests, getRootRequestVersion, getRootRequestVersion);
  return toolCallIds.some((id) => getPendingRootRequest(id) !== null);
}

export const answerToolRootRequest: ToolRootRequestAnswerer | null = answerRootRequest;
