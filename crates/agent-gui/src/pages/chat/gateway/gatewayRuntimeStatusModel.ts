import { createUuid } from "@liveagent/ui/lib/shared/id";
import type { AppSettings } from "../../../lib/settings";

export type GatewayRuntimeStatus = {
  online: boolean;
  enabled: boolean;
  configured: boolean;
  gatewayUrl?: string | null;
  sessionId?: string | null;
  connectedSince?: number | null;
  lastHeartbeat?: number | null;
  lastError?: string | null;
};

type GatewayFallbackSettings = Pick<
  AppSettings["remote"],
  "enabled" | "gatewayUrl" | "token" | "managedLocal" | "localGatewayPort" | "localGatewayToken"
>;

export function isRemoteSettingsConfigured(remote: GatewayFallbackSettings) {
  if (remote.managedLocal) {
    return (
      Number.isInteger(remote.localGatewayPort) &&
      remote.localGatewayPort >= 1 &&
      remote.localGatewayPort <= 65_535 &&
      remote.localGatewayToken.trim() !== ""
    );
  }
  return remote.gatewayUrl.trim() !== "" && remote.token.trim() !== "";
}

export function buildFallbackGatewayStatus(remote: GatewayFallbackSettings): GatewayRuntimeStatus {
  return {
    online: false,
    enabled: remote.enabled,
    configured: isRemoteSettingsConfigured(remote),
    gatewayUrl: remote.managedLocal
      ? `http://127.0.0.1:${remote.localGatewayPort}`
      : remote.gatewayUrl.trim(),
    sessionId: null,
    connectedSince: null,
    lastHeartbeat: null,
    lastError: null,
  };
}

export function createLocalGatewayChatRunId(conversationId: string) {
  return `conversation-live-${conversationId}-${createUuid()}`;
}
