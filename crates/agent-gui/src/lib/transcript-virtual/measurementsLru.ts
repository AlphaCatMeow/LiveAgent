import type { VirtualItem } from "@tanstack/react-virtual";

// Per-conversation snapshots of the transcript virtualizer's measured rows,
// taken on unmount (virtualizer.takeSnapshot()) and fed back through
// initialMeasurementsCache when the conversation reopens — switching back to
// a conversation then lays out with exact row heights instead of estimates.
// In-memory only and layout-gated: measured heights depend on both the scroll
// viewport and the centered transcript width, so callers provide a composite
// layout key. Snapshots are never persisted.

export type TranscriptMeasurementsLru = {
  save: (conversationId: string, layoutKey: string, measurements: VirtualItem[]) => void;
  restore: (conversationId: string, layoutKey: string) => VirtualItem[] | null;
};

const DEFAULT_CAPACITY = 12;

export function createTranscriptMeasurementsLru(
  capacity = DEFAULT_CAPACITY,
): TranscriptMeasurementsLru {
  const entries = new Map<string, { layoutKey: string; measurements: VirtualItem[] }>();

  return {
    save: (conversationId, layoutKey, measurements) => {
      if (!conversationId || !layoutKey || measurements.length === 0) {
        return;
      }
      entries.delete(conversationId);
      entries.set(conversationId, { layoutKey, measurements });
      while (entries.size > capacity) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    restore: (conversationId, layoutKey) => {
      const hit = entries.get(conversationId);
      if (!hit || hit.layoutKey !== layoutKey) {
        return null;
      }
      entries.delete(conversationId);
      entries.set(conversationId, hit);
      return hit.measurements;
    },
  };
}
