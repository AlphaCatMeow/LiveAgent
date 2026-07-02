import type { ConversationActivityEvent, RunActivityState } from "./streamTypes";

// The single source of truth for "which conversations have an active run":
// sidebar dots, busy indicators, everything. Fed by the always-on
// chat.activity broadcast plus history.list hydration — both carry run ids
// composed by the gateway inside the run-lifecycle transition, so there is no
// enrichment race and no local/remote union to reconcile.

export type ConversationActivity = {
  runId: string;
  state: RunActivityState;
  workdir: string | null;
  updatedAt: number;
};

export type ActivitySnapshot = {
  activities: ReadonlyMap<string, ConversationActivity>;
  revision: number;
};

export type ActivityStore = {
  getSnapshot(): ActivitySnapshot;
  subscribe(listener: () => void): () => void;
  isRunning(conversationId: string): boolean;
  get(conversationId: string): ConversationActivity | null;
  applyActivityEvent(event: ConversationActivityEvent): void;
  // history.list `running_conversations` hydration: authoritative snapshot of
  // every active run at response time.
  hydrate(
    items: Array<{
      conversationId: string;
      runId: string;
      state?: string;
      workdir?: string | null;
      updatedAt?: number;
    }>,
  ): void;
  clear(): void;
};

export function createActivityStore(): ActivityStore {
  let activities = new Map<string, ConversationActivity>();
  let snapshot: ActivitySnapshot = { activities, revision: 0 };
  const listeners = new Set<() => void>();

  const emit = () => {
    snapshot = { activities, revision: snapshot.revision + 1 };
    for (const listener of listeners) {
      listener();
    }
  };

  const normalizeState = (state: string | undefined | null): RunActivityState => {
    return state === "queued" || state === "cancelling" ? state : "running";
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isRunning: (conversationId) => activities.has(conversationId),
    get: (conversationId) => activities.get(conversationId) ?? null,

    applyActivityEvent: (event) => {
      const current = activities.get(event.conversationId);
      // Activity events are state signals ordered per conversation by the
      // gateway; a stale timestamp can only appear after a reconnect race —
      // ignore anything older than what we already show.
      if (current && event.updatedAt > 0 && event.updatedAt < current.updatedAt) {
        return;
      }
      if (!event.running || !event.runId) {
        if (!activities.has(event.conversationId)) {
          return;
        }
        activities = new Map(activities);
        activities.delete(event.conversationId);
        emit();
        return;
      }
      const next: ConversationActivity = {
        runId: event.runId,
        state: event.state ?? "running",
        workdir: event.workdir,
        updatedAt: event.updatedAt,
      };
      if (
        current &&
        current.runId === next.runId &&
        current.state === next.state &&
        current.workdir === next.workdir
      ) {
        return;
      }
      activities = new Map(activities);
      activities.set(event.conversationId, next);
      emit();
    },

    hydrate: (items) => {
      const next = new Map<string, ConversationActivity>();
      for (const item of items) {
        const conversationId = item.conversationId.trim();
        const runId = item.runId.trim();
        if (!conversationId || !runId) {
          continue;
        }
        next.set(conversationId, {
          runId,
          state: normalizeState(item.state),
          workdir: item.workdir?.trim() || null,
          updatedAt: item.updatedAt ?? 0,
        });
      }
      let changed = next.size !== activities.size;
      if (!changed) {
        for (const [conversationId, activity] of next) {
          const current = activities.get(conversationId);
          if (!current || current.runId !== activity.runId || current.state !== activity.state) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        return;
      }
      activities = next;
      emit();
    },

    clear: () => {
      if (activities.size === 0) {
        return;
      }
      activities = new Map();
      emit();
    },
  };
}
