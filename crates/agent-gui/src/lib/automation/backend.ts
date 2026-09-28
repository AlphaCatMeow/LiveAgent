// Desktop (Tauri) transport for the automation store: direct invoke calls
// plus change events emitted by the Rust AutomationStore notifier. This file
// is the per-platform adapter — the web frontend ships its own copy speaking
// the gateway cron.manage protocol.

import { invoke } from "@liveagent/app/shims/tauriCore";
import { listen } from "@liveagent/app/shims/tauriEvent";
import type {
  AutomationApplyInput,
  AutomationSnapshot,
  CompletePromptRunInput,
  CronApplyResponse,
  CronRunNowResponse,
  CronRunRecord,
  CronSnapshot,
  HooksApplyResponse,
  HooksSnapshot,
  PromptCompletionResponse,
  PromptRunRequest,
} from "@liveagent/ui/lib/automation/types";
import { isKBrainBrowserHost } from "../host";

const CRON_CHANGED_EVENT = "automation:cron-changed";
const HOOKS_CHANGED_EVENT = "automation:hooks-changed";

export type AutomationBackendHandlers = {
  onCron: (snapshot: CronSnapshot) => void;
  onHooks: (snapshot: HooksSnapshot) => void;
};

const EMPTY_SNAPSHOT: AutomationSnapshot = {
  cron: { revision: 0, tasks: [] },
  hooks: { revision: 0, hooks: [] },
};

export const backend = {
  fetchSnapshot(): Promise<AutomationSnapshot> {
    return isKBrainBrowserHost()
      ? Promise.resolve(EMPTY_SNAPSHOT)
      : invoke<AutomationSnapshot>("automation_snapshot");
  },

  cronApply(input: AutomationApplyInput): Promise<CronApplyResponse> {
    if (isKBrainBrowserHost()) {
      return Promise.reject(new Error("K-brain browser mode does not support desktop automation"));
    }
    return invoke<CronApplyResponse>("automation_cron_apply", { input });
  },

  hooksApply(input: AutomationApplyInput): Promise<HooksApplyResponse> {
    if (isKBrainBrowserHost()) {
      return Promise.reject(new Error("K-brain browser mode does not support desktop hooks"));
    }
    return invoke<HooksApplyResponse>("automation_hooks_apply", { input });
  },

  listRuns(taskId: string, limit?: number): Promise<CronRunRecord[]> {
    if (isKBrainBrowserHost()) return Promise.resolve([]);
    return invoke<CronRunRecord[]>("automation_list_runs", {
      task_id: taskId,
      limit: limit ?? 100,
    });
  },

  clearRuns(taskId: string): Promise<number> {
    if (isKBrainBrowserHost()) return Promise.resolve(0);
    return invoke<number>("automation_clear_runs", { task_id: taskId });
  },

  runNow(taskId: string): Promise<CronRunNowResponse> {
    if (isKBrainBrowserHost()) {
      return Promise.reject(new Error("K-brain browser mode does not support desktop automation"));
    }
    return invoke<CronRunNowResponse>("automation_run_cron_now", { task_id: taskId });
  },

  claimPromptRuns(): Promise<PromptRunRequest[]> {
    return invoke<PromptRunRequest[]>("automation_claim_prompt_runs");
  },

  releasePromptRun(executionId: string): Promise<void> {
    return invoke<void>("automation_release_prompt_run", {
      execution_id: executionId,
    });
  },

  completePromptRun(input: CompletePromptRunInput): Promise<PromptCompletionResponse> {
    return invoke<PromptCompletionResponse>("automation_complete_prompt_run", { input });
  },

  async validateCronExpression(expression: string): Promise<void> {
    if (isKBrainBrowserHost()) {
      throw new Error("K-brain browser mode does not support desktop automation");
    }
    await invoke("cron_validate_expression", { expression });
  },

  subscribe(handlers: AutomationBackendHandlers): () => void {
    const unlistenCron = listen<CronSnapshot>(CRON_CHANGED_EVENT, (event) => {
      handlers.onCron(event.payload);
    });
    const unlistenHooks = listen<HooksSnapshot>(HOOKS_CHANGED_EVENT, (event) => {
      handlers.onHooks(event.payload);
    });
    return () => {
      void unlistenCron.then((unlisten) => unlisten());
      void unlistenHooks.then((unlisten) => unlisten());
    };
  },
};
