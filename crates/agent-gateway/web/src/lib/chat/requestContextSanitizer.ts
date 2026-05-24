import type { Context, Message, TextContent, ToolResultMessage } from "../agentTypes";

import type { DisplayImageItemDetails, DisplayImageResultDetails } from "../tools/builtinTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeDisplayImageItem(value: unknown): DisplayImageItemDetails | null {
  if (!isRecord(value)) return null;
  const { path, sourceType, renderMode, sourceUrl, mimeType, sizeBytes, mtimeMs, contentHash } = value;
  if (typeof path !== "string") {
    return null;
  }
  return {
    path,
    ...(typeof sourceType === "string" ? { sourceType: sourceType as DisplayImageItemDetails["sourceType"] } : {}),
    ...(typeof renderMode === "string" ? { renderMode: renderMode as DisplayImageItemDetails["renderMode"] } : {}),
    ...(typeof sourceUrl === "string" ? { sourceUrl } : {}),
    ...(typeof mimeType === "string" ? { mimeType } : {}),
    ...(typeof sizeBytes === "number" ? { sizeBytes } : {}),
    ...(typeof mtimeMs === "number" ? { mtimeMs } : {}),
    ...(typeof contentHash === "string" ? { contentHash } : {}),
  };
}

function getDisplayImageItems(details: unknown): DisplayImageItemDetails[] {
  if (!isRecord(details) || details.kind !== "display_image" || !Array.isArray(details.images)) {
    return [];
  }
  return details.images.flatMap((item) => {
    const normalized = normalizeDisplayImageItem(item);
    return normalized ? [normalized] : [];
  });
}

function isDisplayImageToolResult(message: Message): message is ToolResultMessage<DisplayImageResultDetails> {
  return (
    message.role === "toolResult" &&
    !message.isError &&
    (message.toolName === "Image" ||
      (isRecord(message.details) && message.details.kind === "display_image"))
  );
}

function getToolResultText(message: ToolResultMessage) {
  return message.content
    .flatMap((block) => (block.type === "text" && block.text.trim() ? [block.text.trim()] : []))
    .join("\n\n");
}

function buildDisplayImageContextText(message: ToolResultMessage<DisplayImageResultDetails>) {
  const images = getDisplayImageItems(message.details);
  if (images.length === 0) {
    const text = getToolResultText(message);
    return [
      text || "Image tool displayed image content in the chat UI.",
      "Inline image bytes are omitted from model context because Image is a display-only UI tool.",
    ].join("\n\n");
  }

  const noun = images.length === 1 ? "image" : "images";
  return [
    `Displayed ${images.length} ${noun} in the chat UI successfully.`,
    ...images.map(
      (image, index) => {
        const facts = [
          image.sourceType ? `sourceType=${image.sourceType}` : null,
          image.renderMode ? `renderMode=${image.renderMode}` : null,
          image.mimeType ? `mime=${image.mimeType}` : null,
          typeof image.sizeBytes === "number" ? `sizeBytes=${image.sizeBytes}` : null,
        ].filter(Boolean);
        return `${index + 1}. ${image.path}${facts.length > 0 ? ` (${facts.join(", ")})` : ""}`;
      },
    ),
    "Inline image bytes are omitted from model context because Image is a display-only UI tool.",
  ].join("\n");
}

export function sanitizeMessageForModelContext(message: Message): Message {
  if (!isDisplayImageToolResult(message)) return message;
  const hasInlineImages = message.content.some((block) => block.type === "image");
  const hasDisplayImageDetails = getDisplayImageItems(message.details).length > 0;
  if (!hasInlineImages && !hasDisplayImageDetails) return message;

  const text: TextContent = {
    type: "text",
    text: buildDisplayImageContextText(message),
  };

  return {
    ...message,
    content: [text],
  };
}

export function sanitizeMessagesForModelContext(messages: Message[]): Message[] {
  return messages.map(sanitizeMessageForModelContext);
}

export function sanitizeContextForModelRequest(context: Context): Context {
  return {
    ...context,
    messages: sanitizeMessagesForModelContext(context.messages),
  };
}
