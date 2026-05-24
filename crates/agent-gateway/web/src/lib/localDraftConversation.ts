export const LOCAL_DRAFT_CONVERSATION_PREFIX = "__local_draft__:";

export function createLocalDraftConversationId() {
  return `${LOCAL_DRAFT_CONVERSATION_PREFIX}${crypto.randomUUID()}`;
}

export function isLocalDraftConversationId(conversationId: string) {
  return conversationId.trim().startsWith(LOCAL_DRAFT_CONVERSATION_PREFIX);
}
