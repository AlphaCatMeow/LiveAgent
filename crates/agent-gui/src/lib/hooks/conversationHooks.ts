import { invoke } from "@tauri-apps/api/core";

import type { ConversationHook, ConversationHookType, HookLifecycleEventType } from "../settings";

export type ConversationHookWarning = {
  hookName: string;
  hookType: ConversationHookType;
  event: HookLifecycleEventType;
  message: string;
};

function asErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error ?? "").trim();
  return text || fallback;
}

async function runConversationHook(hook: ConversationHook, workdir?: string) {
  if (hook.type === "command") {
    const script = hook.script?.trim() ?? "";
    if (!script) return;
    await invoke("hook_run_script", {
      workdir: workdir?.trim() || null,
      script,
    } as any);
    return;
  }

  const requests = hook.requests ?? [];
  if (requests.length === 0) return;
  await invoke("hook_run_http_requests", {
    requests,
  } as any);
}

export function createConversationHookDispatcher(params: {
  hooks: ConversationHook[];
  workdir?: string;
  onWarning?: (warning: ConversationHookWarning) => void;
}) {
  const hooksByEvent = new Map<HookLifecycleEventType, ConversationHook[]>();

  for (const hook of params.hooks) {
    if (!hook.enabled) continue;
    const list = hooksByEvent.get(hook.event) ?? [];
    list.push(hook);
    hooksByEvent.set(hook.event, list);
  }

  let queue = Promise.resolve();

  const dispatch = (event: HookLifecycleEventType) => {
    const hooks = hooksByEvent.get(event);
    if (!hooks || hooks.length === 0) return queue;

    queue = queue
      .then(async () => {
        for (const hook of hooks) {
          try {
            await runConversationHook(hook, params.workdir);
          } catch (error) {
            params.onWarning?.({
              hookName: hook.name,
              hookType: hook.type,
              event,
              message: asErrorMessage(error, "Hook 执行失败"),
            });
          }
        }
      })
      .catch(() => undefined);

    return queue;
  };

  return {
    dispatch,
    flush: () => queue.catch(() => undefined),
  };
}
