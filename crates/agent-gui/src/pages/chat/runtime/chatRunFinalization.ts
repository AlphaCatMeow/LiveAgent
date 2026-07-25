export const CHAT_RUN_FINALIZATION_TIMEOUT_MS = 2_000;

export function releaseChatRunUi(params: {
  clearAbortController: () => void;
  clearSendingState: () => void;
  clearToolStatus: () => void;
}) {
  params.clearAbortController();
  params.clearSendingState();
  params.clearToolStatus();
}

export async function settleChatRunFinalization(
  finalization: Promise<unknown>,
  timeoutMs = CHAT_RUN_FINALIZATION_TIMEOUT_MS,
): Promise<"completed" | "timed_out"> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const guardedFinalization = finalization
    .catch((error) => {
      console.warn("chat run finalization failed", error);
    })
    .then(() => "completed" as const);
  const timedOut = new Promise<"timed_out">((resolve) => {
    timeoutId = setTimeout(() => resolve("timed_out"), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([guardedFinalization, timedOut]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
