import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import type { ChatHistorySummary } from "../../lib/chat/history/chatHistory";
import { listChatHistory } from "../../lib/chat/history/chatHistory";
import { sortHistoryItems } from "../../lib/chat/page/chatPageHelpers";
import {
  applyChatHistorySyncEvent,
  CHAT_HISTORY_SYNC_EVENT,
  type ChatHistorySyncEvent,
} from "../../lib/chat/history/chatHistorySync";

const HISTORY_LIST_RECONCILE_INTERVAL_MS = 60_000;

export function useChatHistoryList() {
  const [historyItems, setHistoryItems] = useState<ChatHistorySummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyItemsRef = useRef<ChatHistorySummary[]>([]);
  const disposedRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const queuedRefreshRef = useRef<{ silent: boolean } | null>(null);

  useEffect(() => {
    historyItemsRef.current = historyItems;
  }, [historyItems]);

  const refreshHistory = useCallback(async (options?: { silent?: boolean }) => {
    if (disposedRef.current) {
      return;
    }

    const requestedSilent = options?.silent === true;
    if (requestInFlightRef.current) {
      const queued = queuedRefreshRef.current;
      queuedRefreshRef.current = {
        silent: queued ? queued.silent && requestedSilent : requestedSilent,
      };
      return;
    }

    requestInFlightRef.current = true;
    let nextOptions: { silent: boolean } | null = { silent: requestedSilent };

    while (nextOptions && !disposedRef.current) {
      const silent = nextOptions.silent;
      queuedRefreshRef.current = null;
      if (!silent) {
        setHistoryLoading(true);
      }

      try {
        const items = await listChatHistory();
        if (disposedRef.current) {
          return;
        }
        setHistoryItems(sortHistoryItems(items));
        setHistoryError(null);
      } catch (err) {
        if (disposedRef.current) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (!silent) {
          setHistoryItems([]);
        }
        setHistoryError(msg || "读取历史列表失败");
      } finally {
        if (!silent && !disposedRef.current) {
          setHistoryLoading(false);
        }
      }

      nextOptions = queuedRefreshRef.current;
    }

    requestInFlightRef.current = false;
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    let cancelled = false;
    const unlistenPromise = listen<ChatHistorySyncEvent>(
      CHAT_HISTORY_SYNC_EVENT,
      (event) => {
        if (disposedRef.current) {
          return;
        }

        setHistoryItems((current) => applyChatHistorySyncEvent(current, event.payload));
        setHistoryError(null);
      },
    );

    async function runRefresh(options?: { silent?: boolean }) {
      try {
        await refreshHistory(options);
        if (cancelled) return;
      } catch (err) {
        if (cancelled) return;
      }
    }

    void runRefresh();
    const timer = window.setInterval(() => {
      void runRefresh({ silent: true });
    }, HISTORY_LIST_RECONCILE_INTERVAL_MS);

    return () => {
      cancelled = true;
      disposedRef.current = true;
      void unlistenPromise.then((unlisten) => unlisten());
      window.clearInterval(timer);
    };
  }, [refreshHistory]);

  return {
    historyItems,
    setHistoryItems,
    historyItemsRef,
    historyLoading,
    historyError,
    setHistoryError,
    refreshHistory,
  };
}
