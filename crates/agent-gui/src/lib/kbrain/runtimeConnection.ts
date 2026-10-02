import type { KBrainClientOptions } from "./types";

export type KBrainRuntimeConnection = {
  baseUrl: string;
  token: string;
  protocolVersion: "kbrain.agent.v1";
};

let runtimeConnection: KBrainRuntimeConnection | null = null;

function trim(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function getKBrainRuntimeConnection(): KBrainRuntimeConnection | null {
  return runtimeConnection;
}

export function setKBrainRuntimeConnection(connection: KBrainRuntimeConnection): void {
  if (connection.protocolVersion !== "kbrain.agent.v1" || !trim(connection.baseUrl)) {
    throw new Error("Malformed K-brain backend connection");
  }
  runtimeConnection = {
    baseUrl: connection.baseUrl.trim().replace(/\/+$/, ""),
    token: connection.token.trim(),
    protocolVersion: connection.protocolVersion,
  };
}

export function clearKBrainRuntimeConnection(): void {
  runtimeConnection = null;
}

export function getConfiguredKBrainConnection(): KBrainRuntimeConnection | null {
  if (runtimeConnection) return runtimeConnection;
  const baseUrl = trim(import.meta.env?.VITE_KBRAIN_URL) ?? "http://127.0.0.1:47321";
  return {
    baseUrl,
    token: import.meta.env?.VITE_KBRAIN_TOKEN?.trim() ?? "",
    protocolVersion: "kbrain.agent.v1",
  };
}

export function resolveKBrainClientOptions(options: KBrainClientOptions = {}): KBrainClientOptions {
  const connection = getConfiguredKBrainConnection();
  const baseUrl = options.baseUrl ?? connection?.baseUrl;
  const sameEndpoint =
    baseUrl?.trim().replace(/\/+$/, "") === connection?.baseUrl.trim().replace(/\/+$/, "");
  return {
    ...options,
    baseUrl,
    token: options.token ?? (sameEndpoint ? connection?.token : undefined),
  };
}
