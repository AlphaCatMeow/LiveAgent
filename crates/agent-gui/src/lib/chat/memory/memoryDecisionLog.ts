/**
 * In-memory decision log for silent-memory extraction rounds.
 *
 * This is the data source for a future Decisions Tab (design doc §4.10).
 * P2-4 full UI is out of scope here, but every silent round already produces
 * a four-block protocol output that we now parse — capturing those blocks
 * means the UI can be added later without changing the extraction code.
 *
 * Storage is a per-conversation ring buffer. Entries are not persisted across
 * Tauri restarts; durability is the Decisions Tab feature's responsibility.
 */

import type {
  SilentMemoryParseResult,
  SilentMemoryBlockIdentifyItem,
  SilentMemoryBlockMatchItem,
  SilentMemoryBlockPlanItem,
} from "./memoryProtocol";

export type SilentMemoryDecisionStatus = "parsed" | "parse-failed" | "skipped";

export type SilentMemoryDecisionEntry = {
  conversationId: string;
  recordedAt: number;
  status: SilentMemoryDecisionStatus;
  reason?: string;
  identify?: SilentMemoryBlockIdentifyItem[];
  match?: SilentMemoryBlockMatchItem[];
  plan?: SilentMemoryBlockPlanItem[];
};

const RING_BUFFER_LIMIT_PER_CONVERSATION = 32;
const GLOBAL_BUFFER_LIMIT = 256;

const perConversationLog = new Map<string, SilentMemoryDecisionEntry[]>();
const globalLog: SilentMemoryDecisionEntry[] = [];

type SilentMemoryDecisionListener = (entry: SilentMemoryDecisionEntry) => void;
const listeners = new Set<SilentMemoryDecisionListener>();

function pushEntry(entry: SilentMemoryDecisionEntry) {
  const bucket = perConversationLog.get(entry.conversationId) ?? [];
  bucket.push(entry);
  if (bucket.length > RING_BUFFER_LIMIT_PER_CONVERSATION) {
    bucket.splice(0, bucket.length - RING_BUFFER_LIMIT_PER_CONVERSATION);
  }
  perConversationLog.set(entry.conversationId, bucket);

  globalLog.push(entry);
  if (globalLog.length > GLOBAL_BUFFER_LIMIT) {
    globalLog.splice(0, globalLog.length - GLOBAL_BUFFER_LIMIT);
  }

  for (const listener of listeners) {
    try {
      listener(entry);
    } catch (error) {
      console.warn("silent-memory decision listener threw:", error);
    }
  }
}

/**
 * Record a successful or failed parse of the four-block protocol output.
 */
export function recordSilentMemoryDecision(
  conversationId: string,
  parseResult: SilentMemoryParseResult,
  recordedAtMs: number = Date.now(),
): SilentMemoryDecisionEntry {
  const entry: SilentMemoryDecisionEntry = {
    conversationId,
    recordedAt: recordedAtMs,
    status: parseResult.parseFailed ? "parse-failed" : "parsed",
    reason: parseResult.reason,
    identify: parseResult.blocks.identify?.items,
    match: parseResult.blocks.match?.items,
    plan: parseResult.blocks.plan?.items,
  };
  pushEntry(entry);
  return entry;
}

/**
 * Record that a silent round was skipped before reaching the LLM (e.g. due
 * to throttling or a greeting prefix). Useful for UX visibility.
 */
export function recordSilentMemorySkip(
  conversationId: string,
  reason: string,
  recordedAtMs: number = Date.now(),
): SilentMemoryDecisionEntry {
  const entry: SilentMemoryDecisionEntry = {
    conversationId,
    recordedAt: recordedAtMs,
    status: "skipped",
    reason,
  };
  pushEntry(entry);
  return entry;
}

/** Recent decisions for one conversation, newest last. */
export function getSilentMemoryDecisions(
  conversationId: string,
): readonly SilentMemoryDecisionEntry[] {
  return perConversationLog.get(conversationId) ?? [];
}

/** Recent decisions across all conversations, newest last. */
export function getRecentSilentMemoryDecisions(
  limit: number = 50,
): readonly SilentMemoryDecisionEntry[] {
  const bounded = Math.max(1, Math.min(limit, GLOBAL_BUFFER_LIMIT));
  return globalLog.slice(-bounded);
}

/** Clear the log for one conversation (used by the turn-boundary reset). */
export function clearSilentMemoryDecisions(conversationId: string): void {
  perConversationLog.delete(conversationId);
}

/** Wipe everything; intended for tests and a future "Wipe Decisions" button. */
export function resetSilentMemoryDecisionLog(): void {
  perConversationLog.clear();
  globalLog.length = 0;
}

export function subscribeSilentMemoryDecisions(
  listener: SilentMemoryDecisionListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
