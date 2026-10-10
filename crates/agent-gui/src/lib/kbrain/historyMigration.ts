import type { Message } from "@liveagent/app/lib/agentTypes";
import { invoke } from "@liveagent/app/shims/tauriCore";
import { isTauriHost } from "../host";
import { createKBrainClient } from "./client";
import {
  classifyHistoryMigrationFailure,
  type HistoryMigrationFailureKind,
  type HistoryMigrationFailureRecord,
  knownDeterministicFailure,
  mergeHistoryMigrationFailures,
  readHistoryMigrationFailures,
  writeHistoryMigrationFailures,
} from "./historyMigrationFailures";
import { kBrainStorageScope, setKBrainSessionId } from "./mapping";
import { getConfiguredKBrainConnection } from "./runtimeConnection";
import { contextToKBrainMessages } from "./turn";
import type { KBrainMessage, KBrainModelRef } from "./types";

type LegacySegment = {
  segmentIndex: number;
  segmentId: string;
  messagesJson: string;
  summaryJson?: string | null;
  messageCount?: number;
  startMessageId?: string | null;
  endMessageId?: string | null;
  createdAt?: number;
  updatedAt?: number;
  active?: boolean;
};
export type LegacyConversation = {
  id: string;
  title: string;
  providerId: string;
  model: string;
  sessionId?: string;
  cwd?: string;
  selectedModelJson?: string;
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
  isShared: boolean;
  shareToken?: string;
  redactToolContent: boolean;
  contextMetaJson: string;
  segments: LegacySegment[];
  activeSegmentIndex?: number;
  totalSegmentCount?: number;
  totalMessageCount?: number;
  checkpoint?: LegacyCheckpoint;
};
type LegacyCheckpointRecord = {
  schema: number;
  turnSeq: number;
  turnId: string;
  root: string;
  relPath: string;
  kind: "turn" | "file" | "dir" | "error" | "rewind";
  existedBefore: boolean;
  blob?: string | null;
  blobBase64?: string | null;
  size: number;
  mtimeMs: number;
  capturedAt: number;
  note?: string | null;
  mode?: number | null;
};
type LegacyCheckpoint = {
  status: "available" | "partial" | "not_found" | "unresolved";
  nativePath?: string;
  indexPath?: string;
  indexJsonl?: string;
  records?: LegacyCheckpointRecord[];
  invalidLines?: string[];
  reason?: string;
};
export type LegacyPage = {
  conversations: LegacyConversation[];
  nextCursor?: string | null;
  complete: boolean;
  source?: string;
};
export type MigrationImportResult = {
  source_id: string;
  backend_id: string;
  status: "imported" | "already_imported";
  checkpoint: "available" | "partial" | "not_found" | "unresolved";
  checkpoint_reason?: string;
};
export type MigrationFailure = {
  sourceId: string;
  error: string;
  /** Present for per-conversation failures; absent for source-level paging errors. */
  kind?: HistoryMigrationFailureKind;
  title?: string;
  bytes?: number;
  /** True when startup skipped it because the same content already failed deterministically. */
  skipped?: boolean;
};

export type HistoryMigrationOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /**
   * Re-send conversations that already failed deterministically with unchanged content.
   * Startup leaves this off; the manual "Import old conversations" action turns it on.
   */
  retryKnownFailures?: boolean;
};

function modelFor(item: LegacyConversation): KBrainModelRef {
  try {
    const selected = JSON.parse(item.selectedModelJson ?? "") as {
      customProviderId?: unknown;
      model?: unknown;
    };
    if (typeof selected.customProviderId === "string" && typeof selected.model === "string") {
      return { provider: selected.customProviderId, model: selected.model };
    }
  } catch {
    // Fall back to the persisted summary model.
  }
  return { provider: item.providerId, model: item.model };
}

function messageId(message: Message): string | undefined {
  const raw = (message as Message & { id?: unknown }).id;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function canonicalMessage(value: unknown): KBrainMessage {
  if (!value || typeof value !== "object") {
    throw new Error("legacy history message is not an object");
  }
  const message = value as Message & {
    responseId?: unknown;
    provider?: unknown;
    model?: unknown;
    stopReason?: unknown;
    toolCalls?: unknown;
    timestamp?: unknown;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
  };
  const conversionInput =
    message.role === "toolResult" && message.toolCallId.startsWith("kbrain-subagent:")
      ? { ...message, toolCallId: "legacy-migration-tool" }
      : message;
  const converted = contextToKBrainMessages({ messages: [conversionInput] })[0];
  if (converted?.role === "tool" && message.role === "toolResult")
    converted.tool_call_id = message.toolCallId;
  if (converted?.role === "assistant" && message.role === "assistant") {
    const toolCalls = Array.isArray(message.toolCalls)
      ? message.toolCalls
      : message.content.filter((part) => part.type === "toolCall");
    converted.tool_calls = toolCalls
      .filter((call): call is { id: string; name: string; arguments: unknown } =>
        Boolean(
          call &&
            typeof call === "object" &&
            typeof call.id === "string" &&
            typeof call.name === "string",
        ),
      )
      .map((call) => ({ id: call.id, name: call.name, arguments: call.arguments }));
  }
  if (!converted) throw new Error("legacy history contains an unsupported message");
  const id = messageId(message);
  const createdAt =
    typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
      ? new Date(message.timestamp).toISOString()
      : undefined;
  if (converted.role === "user") {
    return { ...converted, ...(id ? { id } : {}), ...(createdAt ? { created_at: createdAt } : {}) };
  }
  if (converted.role === "tool") {
    return { ...converted, ...(id ? { id } : {}), ...(createdAt ? { created_at: createdAt } : {}) };
  }
  // An explicit row ID wins; responseId is only a fallback for rows without one.
  const assistantId =
    id ?? (typeof message.responseId === "string" ? message.responseId.trim() : "");
  return {
    ...converted,
    ...(assistantId ? { id: assistantId } : {}),
    ...(typeof message.provider === "string" ? { provider: message.provider } : {}),
    ...(typeof message.model === "string" ? { model: message.model } : {}),
    ...(typeof message.stopReason === "string" ? { stop_reason: message.stopReason } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(message.usage
      ? {
          usage: {
            input_tokens: message.usage.input,
            output_tokens: message.usage.output,
            cached_tokens: message.usage.cacheRead,
            cache_write_tokens: message.usage.cacheWrite,
          },
        }
      : {}),
  };
}

// summaryJson is retained in source_metadata, not replayed as an assistant answer.
export function canonicalMessagesForMigration(item: LegacyConversation): KBrainMessage[] {
  const out: KBrainMessage[] = [];
  try {
    const meta = JSON.parse(item.contextMetaJson) as { systemPrompt?: unknown };
    if (typeof meta.systemPrompt === "string" && meta.systemPrompt.trim()) {
      out.push({ role: "system", content: [{ type: "text", text: meta.systemPrompt }] });
    }
  } catch {
    // Context metadata is retained in source_metadata even if its optional prompt is malformed.
  }
  const seen = new Set<string>();
  const orderedSegments = [...item.segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  for (const segment of orderedSegments) {
    const parsed: unknown = JSON.parse(segment.messagesJson);
    if (!Array.isArray(parsed))
      throw new Error(`legacy segment ${segment.segmentId} is not an array`);
    for (const value of parsed) {
      const converted = canonicalMessage(value);
      const id = converted.id?.trim();
      if (id && seen.has(id)) {
        const explicitId = messageId(value as Message);
        if (explicitId || converted.role !== "assistant") {
          throw new Error(`duplicate legacy message id ${id}`);
        }
        delete converted.id;
      } else if (id) {
        seen.add(id);
      }
      out.push(converted);
    }
  }
  return out;
}

function activeContextForMigration(item: LegacyConversation, messages: KBrainMessage[]) {
  const segments = [...item.segments].sort((a, b) => a.segmentIndex - b.segmentIndex);
  const activeIndex = item.activeSegmentIndex ?? segments.at(-1)?.segmentIndex;
  if (segments.length === 0) return undefined;
  const active = segments.find((segment) => segment.segmentIndex === activeIndex);
  if (!active || active !== segments.at(-1))
    throw new Error("invalid legacy active segment boundary");
  let cutoff = messages[0]?.role === "system" ? 1 : 0;
  for (const segment of segments) {
    if (segment === active) break;
    cutoff += JSON.parse(segment.messagesJson).length;
  }
  let summary = "";
  if (active.summaryJson) {
    const parsed = JSON.parse(active.summaryJson);
    if (parsed?.role !== "summary" || typeof parsed.content !== "string") {
      throw new Error("invalid legacy active summary");
    }
    summary = parsed.content;
  }
  return { cutoff, summary };
}

function validateCheckpointExport(checkpoint: LegacyCheckpoint | undefined) {
  if (checkpoint === undefined) return;
  if (
    !checkpoint ||
    !["available", "partial", "not_found", "unresolved"].includes(checkpoint.status) ||
    (checkpoint.records !== undefined && !Array.isArray(checkpoint.records)) ||
    (checkpoint.invalidLines !== undefined &&
      (!Array.isArray(checkpoint.invalidLines) ||
        checkpoint.invalidLines.some((line) => typeof line !== "string")))
  ) {
    throw new Error("invalid legacy checkpoint export");
  }
  for (const record of checkpoint.records ?? []) {
    if (
      !record ||
      record.schema !== 2 ||
      !["turn", "file", "dir", "error", "rewind"].includes(record.kind) ||
      [record.turnSeq, record.size, record.mtimeMs, record.capturedAt].some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      ) ||
      [record.turnId, record.root, record.relPath].some((value) => typeof value !== "string") ||
      typeof record.existedBefore !== "boolean" ||
      (record.blobBase64 != null && typeof record.blobBase64 !== "string") ||
      (record.mode != null &&
        (!Number.isSafeInteger(record.mode) || record.mode < 0 || record.mode > 0xffffffff))
    ) {
      throw new Error("invalid legacy checkpoint record");
    }
  }
}

async function fingerprint(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type CachedMigration = {
  fingerprint: string;
  result: MigrationImportResult;
};

function migrationCacheKey(baseUrl: string) {
  return `liveagent.kbrain-history-migration.v1:${baseUrl}`;
}

function readMigrationCache(baseUrl: string): Record<string, CachedMigration> {
  try {
    const raw = globalThis.localStorage?.getItem(migrationCacheKey(baseUrl));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, CachedMigration>;
  } catch {
    return {};
  }
}

function writeMigrationCache(baseUrl: string, cache: Record<string, CachedMigration>) {
  try {
    globalThis.localStorage?.setItem(migrationCacheKey(baseUrl), JSON.stringify(cache));
  } catch {
    // Storage is optional; K-brain fingerprint idempotency remains authoritative.
  }
}

function isStableMigrationResult(result: MigrationImportResult) {
  return result.checkpoint === "available" || result.checkpoint === "not_found";
}

export function historyErrorStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
}

export async function migrateLegacyHistoryPage(
  page: LegacyPage,
  options: HistoryMigrationOptions = {},
): Promise<{
  results: MigrationImportResult[];
  failures: MigrationFailure[];
  nextCursor?: string | null;
  complete: boolean;
}> {
  const connection = getConfiguredKBrainConnection();
  if (!connection) throw new Error("K-brain backend connection is not ready");
  const client = createKBrainClient({
    fetch: options.fetch,
  });
  const results: MigrationImportResult[] = [];
  const failures: MigrationFailure[] = [];
  const scope = kBrainStorageScope();
  const cache = readMigrationCache(scope);
  let cacheChanged = false;
  const knownFailures = readHistoryMigrationFailures(scope);
  const failedRecords: HistoryMigrationFailureRecord[] = [];
  const succeededIds: string[] = [];
  for (const item of page.conversations) {
    let sourceFingerprint = "";
    let bodyBytes: number | undefined;
    // Only the import POST speaks for the payload; earlier existence checks (GET) failing
    // with 401/403/500 say nothing about whether this conversation can ever be imported.
    let importAttempted = false;
    try {
      validateCheckpointExport(item.checkpoint);
      const messages = canonicalMessagesForMigration(item);
      sourceFingerprint = await fingerprint({ item, messages });
      const known = options.retryKnownFailures
        ? undefined
        : knownDeterministicFailure(knownFailures, item.id, sourceFingerprint);
      if (known) {
        // Same content failed the same way before; re-sending would only fail again.
        failures.push({
          sourceId: item.id,
          error: known.message,
          kind: known.kind,
          title: known.title,
          bytes: known.bytes,
          skipped: true,
        });
        continue;
      }
      const cached = cache[item.id];
      if (cached?.fingerprint === sourceFingerprint && isStableMigrationResult(cached.result)) {
        let exists = true;
        try {
          await client.getSession(cached.result.backend_id, options.signal);
        } catch (error) {
          if (historyErrorStatus(error) !== 404) throw error;
          exists = false;
        }
        if (exists) {
          const cachedResult: MigrationImportResult = {
            ...cached.result,
            status: "already_imported",
          };
          setKBrainSessionId(item.id, cachedResult.backend_id);
          results.push(cachedResult);
          continue;
        }
      }
      const payload = {
        source_id: item.id,
        source_fingerprint: sourceFingerprint,
        conversation_id: item.id,
        title: item.title,
        cwd: item.cwd,
        model: modelFor(item),
        created_at: new Date(item.createdAt).toISOString(),
        updated_at: new Date(item.updatedAt).toISOString(),
        pinned: item.isPinned,
        shared: item.isShared,
        share_token: item.shareToken,
        share_redact_tool: item.redactToolContent,
        messages,
        active_context: activeContextForMigration(item, messages),
        checkpoint: item.checkpoint ?? {
          status: "unresolved",
          nativePath: `~/.liveagent/checkpoints/${item.id}`,
        },
        source_metadata: {
          original: item,
          session_id: item.sessionId,
          selected_model_json: item.selectedModelJson,
          context_meta_json: item.contextMetaJson,
          active_segment_index: item.activeSegmentIndex,
          total_segment_count: item.totalSegmentCount,
          total_message_count: item.totalMessageCount,
          segments: [...item.segments]
            .sort((left, right) => left.segmentIndex - right.segmentIndex)
            .map((segment) => ({
              index: segment.segmentIndex,
              id: segment.segmentId,
              summary_json: segment.summaryJson,
              message_count: segment.messageCount,
              start_message_id: segment.startMessageId,
              end_message_id: segment.endMessageId,
              created_at: segment.createdAt,
              updated_at: segment.updatedAt,
              messages_json: segment.messagesJson,
              active: segment.active === true || segment.segmentIndex === item.activeSegmentIndex,
            })),
          checkpoint: item.checkpoint ?? {
            status: "unresolved",
            nativePath: `~/.liveagent/checkpoints/${item.id}`,
            reason: "checkpoint export was not supplied",
          },
        },
      };
      bodyBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
      importAttempted = true;
      const result = await client.importLegacyHistory(payload, options.signal);
      if (
        result.source_id !== item.id ||
        result.backend_id !== item.id ||
        !["imported", "already_imported"].includes(result.status)
      ) {
        throw new Error("legacy history import response identity mismatch");
      }
      setKBrainSessionId(item.id, result.backend_id);
      if (isStableMigrationResult(result)) {
        cache[item.id] = { fingerprint: sourceFingerprint, result };
        cacheChanged = true;
      }
      succeededIds.push(item.id);
      results.push(result);
    } catch (error) {
      const status = historyErrorStatus(error);
      // The backend persists deletion intent across restarts and clients.
      if (status === 410) {
        succeededIds.push(item.id);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      const kind = importAttempted
        ? classifyHistoryMigrationFailure({
            status: Number.isFinite(status) ? status : undefined,
            message,
            bytes: bodyBytes,
          })
        : "transient";
      failures.push({
        sourceId: item.id,
        error: message,
        kind,
        title: item.title,
        bytes: bodyBytes,
      });
      if (sourceFingerprint) {
        failedRecords.push({
          sourceId: item.id,
          title: item.title,
          fingerprint: sourceFingerprint,
          kind,
          bytes: bodyBytes,
          message,
          failedAt: Date.now(),
        });
      }
    }
  }
  if (cacheChanged) writeMigrationCache(scope, cache);
  if (failedRecords.length > 0 || succeededIds.length > 0) {
    writeHistoryMigrationFailures(
      scope,
      mergeHistoryMigrationFailures(readHistoryMigrationFailures(scope), {
        succeeded: succeededIds,
        failed: failedRecords,
      }),
    );
  }
  return {
    results,
    failures,
    nextCursor: page.nextCursor,
    complete:
      page.complete &&
      failures.length === 0 &&
      results.every(
        (result) => result.checkpoint === "available" || result.checkpoint === "not_found",
      ),
  };
}

const recoveries = new Map<string, Promise<boolean>>();

export async function recoverLegacyHistory(id: string): Promise<boolean> {
  if (!isTauriHost() || !getConfiguredKBrainConnection()) return false;
  const key = `${kBrainStorageScope()}:${id}`;
  const pending = recoveries.get(key);
  if (pending) return pending;
  const recovery = (async () => {
    for (const command of ["legacy_history_migration_page", "pi_history_migration_page"] as const) {
      let cursor: string | undefined;
      do {
        const page = await invoke<LegacyPage>(command, { cursor });
        const item = page.conversations.find((item) => item.id === id);
        if (item) {
          const migrated = await migrateLegacyHistoryPage({
            conversations: [item],
            complete: true,
          });
          if (migrated.failures.length) throw new Error(migrated.failures[0].error);
          return migrated.results.length === 1;
        }
        if (page.complete) break;
        if (!page.nextCursor || page.nextCursor === cursor) {
          throw new Error(`${command} did not advance its cursor`);
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    }
    return false;
  })();
  recoveries.set(key, recovery);
  try {
    return await recovery;
  } finally {
    recoveries.delete(key);
  }
}

async function migrateHistorySourceOnce(
  command: "legacy_history_migration_page" | "pi_history_migration_page",
  options: HistoryMigrationOptions = {},
) {
  if (!isTauriHost() || !getConfiguredKBrainConnection()) {
    return { results: [], failures: [], complete: true };
  }
  let cursor: string | undefined;
  const all: MigrationImportResult[] = [];
  const failures: MigrationFailure[] = [];
  try {
    do {
      const page = await invoke<LegacyPage>(command, { cursor });
      const migrated = await migrateLegacyHistoryPage(page, options);
      all.push(...migrated.results);
      failures.push(...migrated.failures);
      if (page.complete) break;
      if (!migrated.nextCursor || migrated.nextCursor === cursor) {
        throw new Error(`${command} did not advance its cursor`);
      }
      cursor = migrated.nextCursor;
    } while (cursor !== undefined);
  } catch (error) {
    failures.push({
      sourceId: command,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    results: all,
    failures,
    complete:
      failures.length === 0 &&
      all.every((result) => result.checkpoint === "available" || result.checkpoint === "not_found"),
  };
}

export async function migrateLegacyHistoryOnce(options: HistoryMigrationOptions = {}) {
  return migrateHistorySourceOnce("legacy_history_migration_page", options);
}

export async function migratePiHistoryOnce(options: HistoryMigrationOptions = {}) {
  return migrateHistorySourceOnce("pi_history_migration_page", options);
}

export async function migrateAllHistoryOnce(options: HistoryMigrationOptions = {}) {
  const [legacy, pi] = await Promise.all([
    migrateLegacyHistoryOnce(options),
    migratePiHistoryOnce(options),
  ]);
  return {
    results: [...legacy.results, ...pi.results],
    failures: [...legacy.failures, ...pi.failures],
    complete: legacy.complete && pi.complete,
  };
}
