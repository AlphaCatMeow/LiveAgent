import { invoke } from "@tauri-apps/api/core";

import type {
  ConversationViewState,
  StoredContextSegment,
} from "../conversation/conversationState";

export type SubagentRunStatus = "running" | "completed" | "failed" | "cancelled";

export type SubagentIdentityRecord = {
  parentConversationId: string;
  logicalAgentId: string;
  displayName: string;
  role: string;
  identityPrompt: string;
  agentId?: string;
  templateName?: string;
  defaultMode: string;
  defaultTaskIntent: string;
  defaultApplyPolicy: string;
  createdParentToolCallId?: string;
  createdAt: number;
  updatedAt: number;
};

export type SubagentIdentityUpsertInput = {
  parentConversationId?: string;
  logicalAgentId: string;
  displayName: string;
  role: string;
  identityPrompt: string;
  agentId?: string;
  templateName?: string;
  defaultMode: string;
  defaultTaskIntent: string;
  defaultApplyPolicy: string;
  createdParentToolCallId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type SubagentIdentityListInput = {
  parentConversationId?: string;
  limit?: number;
};

export type SubagentRunHistoryInput = {
  id: string;
  parentConversationId?: string;
  parentSessionId?: string;
  parentToolCallId: string;
  parentToolName: string;
  agentIndex: number;
  agentTotal: number;
  logicalAgentId: string;
  agentId?: string;
  agentName?: string;
  description: string;
  mode: string;
  status: SubagentRunStatus;
  providerId: string;
  model: string;
  sessionId?: string;
  workdir?: string;
  worktreeRoot?: string;
  branchName?: string;
  state: ConversationViewState;
  roundCount: number;
  toolCallCount: number;
  compactionCount: number;
  summary?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type SubagentRunEventInput = {
  runId: string;
  eventType: string;
  roundIndex?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  payload?: unknown;
  createdAt?: number;
};

export type SubagentMessageChannel = "direct" | "shared" | "decision" | "question";

export type SubagentMessageRecord = {
  id: number;
  parentConversationId: string;
  seq: number;
  senderAgentId: string;
  senderDisplayName?: string;
  recipientAgentId: string;
  recipientDisplayName?: string;
  channel: SubagentMessageChannel;
  subject?: string;
  bodyMarkdown: string;
  sourceRunId?: string;
  sourceToolCallId?: string;
  createdAt: number;
};

export type SubagentMessageAppendInput = {
  parentConversationId?: string;
  senderAgentId: string;
  senderDisplayName?: string;
  recipientAgentId: string;
  recipientDisplayName?: string;
  channel: SubagentMessageChannel;
  subject?: string;
  bodyMarkdown: string;
  sourceRunId?: string;
  sourceToolCallId?: string;
  createdAt?: number;
};

export type SubagentMessageListInput = {
  parentConversationId?: string;
  recipientAgentId?: string;
  includeShared?: boolean;
  includeSent?: boolean;
  afterSeq?: number;
  limit?: number;
};

export type SubagentHistoryRecorder = {
  upsertIdentity?: (input: SubagentIdentityUpsertInput) => Promise<SubagentIdentityRecord | null>;
  listIdentities?: (input: SubagentIdentityListInput) => Promise<SubagentIdentityRecord[]>;
  persistRunState: (input: SubagentRunHistoryInput) => Promise<void>;
  appendEvent: (input: SubagentRunEventInput) => Promise<void>;
  appendMessage?: (input: SubagentMessageAppendInput) => Promise<SubagentMessageRecord | null>;
  listMessages?: (input: SubagentMessageListInput) => Promise<SubagentMessageRecord[]>;
  listRuns?: (input: SubagentRunListInput) => Promise<SubagentRunSummary[]>;
  getRunState?: (id: string) => Promise<SubagentRunRecord | null>;
  getRun?: (id: string) => Promise<SubagentRunRecord | null>;
};

export type SubagentRunSummary = {
  id: string;
  parentConversationId?: string;
  parentToolCallId: string;
  parentToolName: string;
  agentIndex: number;
  agentTotal: number;
  logicalAgentId: string;
  agentId?: string;
  agentName?: string;
  description: string;
  mode: string;
  status: SubagentRunStatus;
  providerId: string;
  model: string;
  sessionId?: string;
  workdir?: string;
  worktreeRoot?: string;
  branchName?: string;
  messageCount: number;
  roundCount: number;
  toolCallCount: number;
  compactionCount: number;
  summary?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
  updatedAt: number;
};

export type SubagentRunSegmentRecord = SubagentRunSegmentWireRecord;

export type SubagentRunEventRecord = {
  id: number;
  runId: string;
  eventType: string;
  roundIndex?: number;
  toolCallId?: string;
  toolName?: string;
  isError: boolean;
  payloadJson?: string;
  createdAt: number;
};

export type SubagentRunRecord = SubagentRunSummary & {
  parentSessionId?: string;
  contextMetaJson: string;
  activeSegmentIndex: number;
  totalSegmentCount: number;
  totalMessageCount: number;
  createdAt: number;
  segments: SubagentRunSegmentRecord[];
  events: SubagentRunEventRecord[];
};

export type SubagentRunListInput = {
  parentConversationId?: string;
  limit?: number;
};

export type SubagentRunPruneInput = {
  parentConversationId: string;
  keepParentToolCallIds: string[];
};

export type SubagentRunPruneResult = {
  parentConversationId: string;
  keptParentToolCallCount: number;
  deletedRunCount: number;
  prunedWorktrees: Array<{
    runId: string;
    worktreeRoot: string;
    branchName?: string;
  }>;
  worktreeCleanupCount: number;
  worktreeCleanupErrors: string[];
};

type SubagentRunSegmentWireRecord = {
  segmentIndex: number;
  segmentId: string;
  summaryJson?: string | null;
  messagesJson: string;
  messageCount: number;
  startMessageId?: string;
  endMessageId?: string;
  createdAt: number;
  updatedAt: number;
};

type SubagentRunUpsertWireInput = Omit<
  SubagentRunHistoryInput,
  "state" | "updatedAt"
> & {
  contextMetaJson: string;
  activeSegmentIndex: number;
  totalSegmentCount: number;
  totalMessageCount: number;
  segments: SubagentRunSegmentWireRecord[];
  updatedAt: number;
};

type SubagentRunEventWireInput = Omit<SubagentRunEventInput, "payload"> & {
  payloadJson?: string;
};

const subagentRunWriteQueues = new Map<string, Promise<void>>();

function enqueueSubagentRunWrite(runId: string, task: () => Promise<void>) {
  const key = runId.trim();
  const previous = subagentRunWriteQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  subagentRunWriteQueues.set(key, next);
  next.then(
    () => {
      if (subagentRunWriteQueues.get(key) === next) {
        subagentRunWriteQueues.delete(key);
      }
    },
    () => {
      if (subagentRunWriteQueues.get(key) === next) {
        subagentRunWriteQueues.delete(key);
      }
    },
  );
  return next;
}

function buildSegmentInput(segment: StoredContextSegment): SubagentRunSegmentWireRecord {
  return {
    segmentIndex: segment.segmentIndex,
    segmentId: segment.segmentId,
    summaryJson: segment.summary ? JSON.stringify(segment.summary) : undefined,
    messagesJson: JSON.stringify(segment.messages),
    messageCount: segment.messageCount,
    startMessageId: segment.startMessageId,
    endMessageId: segment.endMessageId,
    createdAt: segment.createdAt,
    updatedAt: segment.updatedAt,
  };
}

function buildRunInput(input: SubagentRunHistoryInput): SubagentRunUpsertWireInput {
  const updatedAt = input.updatedAt ?? Date.now();
  const compactMeta = {
    schemaVersion: input.state.meta.schemaVersion,
    activeSegmentIndex: input.state.activeSegmentIndex,
    totalSegmentCount: input.state.meta.totalSegmentCount,
    totalMessageCount: input.state.meta.totalMessageCount,
  };
  return {
    id: input.id,
    parentConversationId: input.parentConversationId,
    parentSessionId: input.parentSessionId,
    parentToolCallId: input.parentToolCallId,
    parentToolName: input.parentToolName,
    agentIndex: input.agentIndex,
    agentTotal: input.agentTotal,
    logicalAgentId: input.logicalAgentId,
    agentId: input.agentId,
    agentName: input.agentName,
    description: input.description,
    mode: input.mode,
    status: input.status,
    providerId: input.providerId,
    model: input.model,
    sessionId: input.sessionId,
    workdir: input.workdir,
    worktreeRoot: input.worktreeRoot,
    branchName: input.branchName,
    roundCount: input.roundCount,
    toolCallCount: input.toolCallCount,
    compactionCount: input.compactionCount,
    summary: input.summary,
    error: input.error,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    createdAt: input.createdAt,
    contextMetaJson: JSON.stringify(compactMeta),
    activeSegmentIndex: input.state.activeSegmentIndex,
    totalSegmentCount: input.state.meta.totalSegmentCount,
    totalMessageCount: input.state.meta.totalMessageCount,
    segments: input.state.segments.map(buildSegmentInput),
    updatedAt,
  };
}

function stringifyEventPayload(payload: unknown): string | undefined {
  if (typeof payload === "undefined") return undefined;
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
      fallback: String(payload),
    });
  }
}

function buildEventInput(input: SubagentRunEventInput): SubagentRunEventWireInput {
  return {
    runId: input.runId,
    eventType: input.eventType,
    roundIndex: input.roundIndex,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    isError: input.isError,
    payloadJson: stringifyEventPayload(input.payload),
    createdAt: input.createdAt ?? Date.now(),
  };
}

export async function persistSubagentRunState(input: SubagentRunHistoryInput) {
  const runId = input.id.trim();
  if (!runId) return;
  const wireInput = buildRunInput(input);
  return enqueueSubagentRunWrite(runId, async () => {
    await invoke("subagent_run_upsert", { input: wireInput });
  });
}

export async function upsertSubagentIdentity(input: SubagentIdentityUpsertInput) {
  const parentConversationId = input.parentConversationId?.trim();
  const logicalAgentId = input.logicalAgentId.trim();
  const displayName = input.displayName.trim();
  if (!parentConversationId || !logicalAgentId || !displayName) return null;
  return invoke<SubagentIdentityRecord>("subagent_identity_upsert", {
    input: {
      ...input,
      parentConversationId,
      logicalAgentId,
      displayName,
      role: input.role.trim(),
      identityPrompt: input.identityPrompt.trim(),
      agentId: input.agentId?.trim() || undefined,
      templateName: input.templateName?.trim() || undefined,
      defaultMode: input.defaultMode.trim(),
      defaultTaskIntent: input.defaultTaskIntent.trim(),
      defaultApplyPolicy: input.defaultApplyPolicy.trim(),
      createdParentToolCallId: input.createdParentToolCallId?.trim() || undefined,
      updatedAt: input.updatedAt ?? Date.now(),
    },
  });
}

export async function listSubagentIdentities(input: SubagentIdentityListInput) {
  const parentConversationId = input.parentConversationId?.trim();
  if (!parentConversationId) return [];
  return invoke<SubagentIdentityRecord[]>("subagent_identity_list", {
    input: {
      parentConversationId,
      limit: input.limit,
    },
  });
}

export async function appendSubagentRunEvent(input: SubagentRunEventInput) {
  const runId = input.runId.trim();
  if (!runId || !input.eventType.trim()) return;
  const wireInput = buildEventInput(input);
  return enqueueSubagentRunWrite(runId, async () => {
    await invoke("subagent_run_append_event", { input: wireInput });
  });
}

export async function appendSubagentMessage(input: SubagentMessageAppendInput) {
  const parentConversationId = input.parentConversationId?.trim();
  const senderAgentId = input.senderAgentId.trim();
  const recipientAgentId = input.recipientAgentId.trim();
  const bodyMarkdown = input.bodyMarkdown.trim();
  if (!parentConversationId || !senderAgentId || !recipientAgentId || !bodyMarkdown) {
    return null;
  }
  return invoke<SubagentMessageRecord>("subagent_message_append", {
    input: {
      parentConversationId,
      senderAgentId,
      senderDisplayName: input.senderDisplayName?.trim() || undefined,
      recipientAgentId,
      recipientDisplayName: input.recipientDisplayName?.trim() || undefined,
      channel: input.channel,
      subject: input.subject?.trim() || undefined,
      bodyMarkdown,
      sourceRunId: input.sourceRunId?.trim() || undefined,
      sourceToolCallId: input.sourceToolCallId?.trim() || undefined,
      createdAt: input.createdAt ?? Date.now(),
    },
  });
}

export async function listSubagentMessages(input: SubagentMessageListInput) {
  const parentConversationId = input.parentConversationId?.trim();
  if (!parentConversationId) return [];
  return invoke<SubagentMessageRecord[]>("subagent_message_list", {
    input: {
      parentConversationId,
      recipientAgentId: input.recipientAgentId?.trim() || undefined,
      includeShared: input.includeShared,
      includeSent: input.includeSent,
      afterSeq: input.afterSeq,
      limit: input.limit,
    },
  });
}

export async function listSubagentRuns(input: SubagentRunListInput) {
  return invoke<SubagentRunSummary[]>("subagent_run_list", { input });
}

export async function getSubagentRun(id: string) {
  const runId = id.trim();
  if (!runId) return null;
  return invoke<SubagentRunRecord>("subagent_run_get", { id: runId });
}

export async function getSubagentRunState(id: string) {
  const runId = id.trim();
  if (!runId) return null;
  return invoke<SubagentRunRecord>("subagent_run_get_state", { id: runId });
}

export function collectRetainedSubagentParentToolCallIds(state: ConversationViewState) {
  const keep = new Set<string>();
  for (const segment of state.segments) {
    for (const message of segment.messages) {
      if (message.role !== "toolResult") continue;
      const details = message.details as { kind?: unknown } | undefined;
      const isSubagentParentTool =
        message.toolName === "Agent" ||
        message.toolName === "SendMessage" ||
        details?.kind === "subagent_message";
      if (!isSubagentParentTool) continue;
      const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId.trim() : "";
      if (toolCallId) keep.add(toolCallId);
    }
  }
  return [...keep];
}

export async function pruneSubagentRunsForConversation(input: SubagentRunPruneInput) {
  const parentConversationId = input.parentConversationId.trim();
  if (!parentConversationId) {
    return {
      parentConversationId,
      keptParentToolCallCount: 0,
      deletedRunCount: 0,
      prunedWorktrees: [],
      worktreeCleanupCount: 0,
      worktreeCleanupErrors: [],
    } satisfies SubagentRunPruneResult;
  }
  return invoke<SubagentRunPruneResult>("subagent_run_prune", {
    input: {
      parentConversationId,
      keepParentToolCallIds: input.keepParentToolCallIds
        .map((id) => id.trim())
        .filter(Boolean),
    },
  });
}

export const defaultSubagentHistoryRecorder: SubagentHistoryRecorder = {
  upsertIdentity: upsertSubagentIdentity,
  listIdentities: listSubagentIdentities,
  persistRunState: persistSubagentRunState,
  appendEvent: appendSubagentRunEvent,
  appendMessage: appendSubagentMessage,
  listMessages: listSubagentMessages,
  listRuns: listSubagentRuns,
  getRunState: getSubagentRunState,
  getRun: getSubagentRun,
};
