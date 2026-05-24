import {
  HOOK_EVENT_DESCRIPTION_TRANSLATION_KEYS,
  HOOK_EVENT_TRANSLATION_KEYS,
  type ConversationHookType,
  type HookHttpRequest,
  type HookLifecycleEventType,
} from "../../lib/settings";
import {
  createEmptyTaskRequestDraft,
  taskRequestToDraft,
  type TaskHttpRequestDraft,
} from "./taskConfigUtils";

export type HookHttpRequestDraft = TaskHttpRequestDraft;

export function createEmptyHookRequestDraft(): HookHttpRequestDraft {
  return createEmptyTaskRequestDraft();
}

export function hookRequestToDraft(request?: HookHttpRequest): HookHttpRequestDraft {
  return taskRequestToDraft(request);
}

export function getHookTypeTone(type: ConversationHookType) {
  return type === "command"
    ? "bg-blue-500/10 text-blue-600 dark:text-blue-300"
    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
}

export function getHookEventLabel(
  t: (key: string) => string,
  event: HookLifecycleEventType,
) {
  return t(HOOK_EVENT_TRANSLATION_KEYS[event]);
}

export function getHookEventDescription(
  t: (key: string) => string,
  event: HookLifecycleEventType,
) {
  return t(HOOK_EVENT_DESCRIPTION_TRANSLATION_KEYS[event]);
}
