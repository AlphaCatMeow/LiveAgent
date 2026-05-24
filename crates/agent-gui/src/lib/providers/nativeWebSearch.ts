import type { ProviderId } from "../settings";

export function providerSupportsNativeWebSearch(
  providerId: ProviderId,
  api: string | undefined,
) {
  return (
    (providerId === "codex" && api === "openai-responses") ||
    (providerId === "claude_code" && api === "anthropic-messages") ||
    (providerId === "gemini" && api === "google-generative-ai")
  );
}
