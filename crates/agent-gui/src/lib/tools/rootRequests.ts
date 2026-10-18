// 授权目录请求：K-brain 在工具路径被拒时暂停该调用并发出 root.requested，
// 这里把它挂起为待决项，供工具卡片渲染「授权此目录」，用户答复后再回给 K-brain。
// 与 toolApproval.ts 同构：按 toolCallId 挂起、useSyncExternalStore 订阅、中止即落定。

import type {
  ToolRootAnswerOutcome,
  ToolRootDecision,
  ToolRootRequest,
} from "@liveagent/ui/lib/chat/toolRootRequest";
import type { KBrainRootRequest, KBrainRootResolution } from "../kbrain/types";
import { grantToolRootDirectory } from "../workspaceRootGrantActions";

type PendingRootRequest = {
  request: ToolRootRequest;
  workdir?: string;
  settle: (resolution: KBrainRootResolution) => void;
};

const pendingByToolCallId = new Map<string, PendingRootRequest>();
const listeners = new Set<() => void>();
let version = 0;

function emitChange() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeRootRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRootRequestVersion() {
  return version;
}

export function getPendingRootRequest(toolCallId: string): ToolRootRequest | null {
  return pendingByToolCallId.get(toolCallId)?.request ?? null;
}

/** Suspends a paused tool call until the user answers or `signal` aborts (denied). */
export function requestRootGrant(input: {
  request: KBrainRootRequest;
  workdir?: string;
  signal: AbortSignal;
}): Promise<KBrainRootResolution> {
  const toolCallId = input.request.tool_call_id?.trim();
  // Without a tool call to attach the card to, nobody could answer: fail fast.
  if (!toolCallId || input.signal.aborted) return Promise.resolve({ decision: "deny" });
  return new Promise((resolve) => {
    const settle = (resolution: KBrainRootResolution) => {
      if (pendingByToolCallId.get(toolCallId)?.settle !== settle) return;
      pendingByToolCallId.delete(toolCallId);
      input.signal.removeEventListener("abort", onAbort);
      emitChange();
      resolve(resolution);
    };
    const onAbort = () => settle({ decision: "deny" });
    pendingByToolCallId.set(toolCallId, {
      request: {
        code: input.request.code,
        path: input.request.path,
        access: input.request.access,
      },
      workdir: input.workdir,
      settle,
    });
    input.signal.addEventListener("abort", onAbort, { once: true });
    emitChange();
  });
}

export async function answerRootRequest(
  toolCallId: string,
  decision: ToolRootDecision,
): Promise<ToolRootAnswerOutcome> {
  const pending = pendingByToolCallId.get(toolCallId);
  if (!pending) throw new Error("这个授权请求已失效");
  if (decision.decision === "deny") {
    pending.settle({ decision: "deny" });
    return {};
  }
  const directory = await grantToolRootDirectory({
    path: pending.request.path,
    workdir: pending.workdir,
    scope: decision.scope,
    access: decision.access,
  });
  pending.settle({ decision: "grant", roots: [{ path: directory, access: decision.access }] });
  return { directory };
}
