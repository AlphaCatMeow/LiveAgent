import type { ChatEvent } from "./gatewayTypes";
import { isLocalDraftConversationId } from "./localDraftConversation";

const CHAT_STREAM_NOT_AVAILABLE_RE = /\bchat stream not available\b/i;

export type ChatStreamUnavailableRecoveryAction =
  | "refresh-history-snapshot"
  | "reload-history";

export function isChatStreamNotAvailableMessage(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : String(value ?? "");
  return CHAT_STREAM_NOT_AVAILABLE_RE.test(message.trim());
}

export function isChatStreamNotAvailableEvent(event: ChatEvent) {
  return (
    event.type === "error" &&
    isChatStreamNotAvailableMessage(event.message)
  );
}

export function resolveChatStreamUnavailableRecoveryAction(
  conversationId: string,
): ChatStreamUnavailableRecoveryAction {
  return isLocalDraftConversationId(conversationId)
    ? "reload-history"
    : "refresh-history-snapshot";
}
