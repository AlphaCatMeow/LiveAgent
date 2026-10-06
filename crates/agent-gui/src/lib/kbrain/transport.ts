import { isTauriHost } from "../host";
import { connectKBrainBackend } from "./bootstrap";
import { getConfiguredKBrainConnection, resolveKBrainClientOptions } from "./runtimeConnection";
import type { KBrainClientOptions } from "./types";

let reconnect: ReturnType<typeof connectKBrainBackend> | undefined;

function refreshConnection() {
  reconnect ??= connectKBrainBackend().finally(() => {
    reconnect = undefined;
  });
  return reconnect;
}

export async function fetchKBrain(
  path: string,
  init: RequestInit = {},
  input: KBrainClientOptions = {},
  retryRead = false,
): Promise<Response> {
  const managed = input.baseUrl === undefined && input.token === undefined && !input.fetch;
  const options = resolveKBrainClientOptions(input);
  const baseUrl = options.baseUrl?.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("K-brain backend connection is not ready");
  const send = (url: string, token?: string) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token?.trim()) headers.set("Authorization", `Bearer ${token.trim()}`);
    return (input.fetch ?? globalThis.fetch)(`${url}${path}`, { ...init, headers });
  };
  let response: Response | undefined;
  let failure: unknown;
  try {
    response = await send(baseUrl, options.token);
    if (response.status !== 401) return response;
  } catch (error) {
    failure = error;
  }
  if (!managed || !isTauriHost() || init.signal?.aborted) {
    if (response) return response;
    throw failure;
  }
  let connection = getConfiguredKBrainConnection();
  if (connection?.baseUrl === baseUrl && connection.token === options.token) {
    try {
      connection = await refreshConnection();
    } catch {
      if (response) return response;
      throw failure;
    }
  }
  if (init.signal?.aborted) throw init.signal.reason;
  const safeToRetry = retryRead || ["GET", "HEAD"].includes(init.method ?? "GET");
  // A failed write may already have committed. Refresh its connection without replaying it.
  if (!safeToRetry || !connection) {
    if (response) return response;
    throw failure;
  }
  await response?.body?.cancel();
  return send(connection.baseUrl, connection.token);
}
