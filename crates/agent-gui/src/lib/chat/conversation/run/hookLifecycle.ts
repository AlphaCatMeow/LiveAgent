import type { HookLifecycleEventType } from "../../../settings";

export type ConversationHookLifecycle = {
  queue: (event: HookLifecycleEventType) => void;
  startAgent: () => void;
  startTurn: (round: number) => void;
  messageUpdated: () => void;
  assistantMessageCompleted: (round: number, toolCallCount: number) => void;
  toolExecutionStarted: () => void;
  toolResultReceived: (round: number) => void;
  ensureMessageEnded: () => void;
  endTurn: (round: number) => void;
  endAgent: () => void;
};

export function createConversationHookLifecycle(
  dispatch: (event: HookLifecycleEventType) => void,
): ConversationHookLifecycle {
  let agentStarted = false;
  let agentEnded = false;
  let activeRound = 0;
  let turnStarted = false;
  let turnEnded = false;
  let messageStarted = false;
  let messageEnded = false;
  const pendingToolExecutions = new Map<number, number>();

  const queue = (event: HookLifecycleEventType) => {
    dispatch(event);
  };

  const ensureMessageEnded = () => {
    if (!messageStarted || messageEnded) return;
    messageEnded = true;
    queue("message_end");
  };

  const endTurn = (round: number) => {
    if (!turnStarted || turnEnded || activeRound !== round) return;
    ensureMessageEnded();
    turnEnded = true;
    pendingToolExecutions.delete(round);
    queue("turn_end");
  };

  return {
    queue,
    startAgent() {
      if (agentStarted) return;
      agentStarted = true;
      queue("agent_start");
    },
    startTurn(round: number) {
      activeRound = round;
      turnStarted = true;
      turnEnded = false;
      messageStarted = true;
      messageEnded = false;
      queue("turn_start");
      queue("message_start");
    },
    messageUpdated() {
      queue("message_update");
    },
    assistantMessageCompleted(round: number, toolCallCount: number) {
      ensureMessageEnded();
      pendingToolExecutions.set(round, toolCallCount);
      if (toolCallCount === 0) {
        endTurn(round);
      }
    },
    toolExecutionStarted() {
      queue("tool_execution_start");
    },
    toolResultReceived(round: number) {
      queue("tool_execution_update");
      queue("tool_execution_end");
      const remaining = (pendingToolExecutions.get(round) ?? 1) - 1;
      if (remaining <= 0) {
        endTurn(round);
      } else {
        pendingToolExecutions.set(round, remaining);
      }
    },
    ensureMessageEnded,
    endTurn,
    endAgent() {
      if (!agentStarted || agentEnded) return;
      if (turnStarted && !turnEnded) {
        endTurn(activeRound);
      }
      agentEnded = true;
      queue("agent_end");
    },
  };
}
