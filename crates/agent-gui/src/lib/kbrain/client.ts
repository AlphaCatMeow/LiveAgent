import {
  KBRAIN_PROTOCOL_VERSION,
  type KBrainBranchRequest,
  type KBrainClientOptions,
  type KBrainCreateSessionRequest,
  type KBrainEditRequest,
  type KBrainEvent,
  type KBrainHistoryResponse,
  type KBrainModelRef,
  type KBrainPromptRequest,
  type KBrainRunAccepted,
  type KBrainSession,
  type KBrainSessionPage,
  type KBrainSharedProjection,
  type KBrainShareStatus,
  type KBrainTextGenerateRequest,
  type KBrainTextGenerateResponse,
  type KBrainUpdateSessionRequest,
} from "./types";

export type KBrainEventHandlers = {
  onEvent: (event: KBrainEvent) => void;
  onError?: (error: Error) => void;
};

function trimBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function readError(response: Response) {
  const body = await response.text();
  let message = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    message = parsed.error || parsed.message || message;
  } catch {
    // Keep the original response body for non-JSON server errors.
  }
  const error = new Error(message || `K-brain request failed (${response.status})`);
  Object.assign(error, { status: response.status });
  return error;
}

export function createKBrainClient(options: KBrainClientOptions = {}) {
  const baseUrl = trimBaseUrl(options.baseUrl ?? "http://127.0.0.1:47321");
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = () => ({
    Accept: "application/json",
    ...(options.token?.trim() ? { Authorization: `Bearer ${options.token.trim()}` } : {}),
  });

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers(),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw await readError(response);
    return (await response.json()) as T;
  }

  async function createSession(input: KBrainCreateSessionRequest): Promise<KBrainSession> {
    return request<KBrainSession>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async function listSessions(
    params: {
      page?: number;
      pageSize?: number;
      cwd?: string;
      cwdEmpty?: boolean;
      shared?: boolean;
    } = {},
  ): Promise<KBrainSessionPage> {
    const query = new URLSearchParams();
    query.set("page", String(Math.max(1, params.page ?? 1)));
    query.set("page_size", String(Math.max(1, params.pageSize ?? 50)));
    if (params.cwd !== undefined) query.set("cwd", params.cwd);
    if (params.cwdEmpty !== undefined) query.set("cwd_empty", String(params.cwdEmpty));
    if (params.shared !== undefined) query.set("shared", String(params.shared));
    const result = await request<KBrainSessionPage | KBrainSession[]>(`/v1/sessions?${query}`);
    return Array.isArray(result)
      ? { sessions: result, total_count: result.length }
      : {
          sessions: result.sessions ?? [],
          total_count: result.total_count ?? result.sessions?.length ?? 0,
          version: result.version,
        };
  }

  async function listModels(): Promise<KBrainModelRef[]> {
    const result = await request<{ models?: KBrainModelRef[] } | KBrainModelRef[]>("/v1/models");
    return Array.isArray(result) ? result : (result.models ?? []);
  }

  async function getSession(conversationId: string): Promise<KBrainSession> {
    return request<KBrainSession>(`/v1/sessions/${encodeURIComponent(conversationId)}`);
  }

  async function getHistory(
    conversationId: string,
    params: {
      maxMessages: number;
      beforeOffset?: number;
      expectedRevision?: string;
      includeActive?: boolean;
    },
  ): Promise<KBrainHistoryResponse> {
    const query = new URLSearchParams({ max_messages: String(params.maxMessages) });
    if (params.beforeOffset !== undefined) query.set("before_offset", String(params.beforeOffset));
    if (params.expectedRevision !== undefined)
      query.set("expected_revision", params.expectedRevision);
    if (params.includeActive !== undefined)
      query.set("include_active", String(params.includeActive));
    return request<KBrainHistoryResponse>(
      `/v1/sessions/${encodeURIComponent(conversationId)}/history?${query}`,
    );
  }

  async function branchSession(
    conversationId: string,
    input: KBrainBranchRequest,
  ): Promise<KBrainSession> {
    return request<KBrainSession>(`/v1/sessions/${encodeURIComponent(conversationId)}/branch`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async function editSession(
    conversationId: string,
    input: KBrainEditRequest,
  ): Promise<KBrainSession> {
    return request<KBrainSession>(`/v1/sessions/${encodeURIComponent(conversationId)}/edit`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async function deleteSession(conversationId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/sessions/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    });
  }

  async function getShare(conversationId: string): Promise<KBrainShareStatus> {
    return request<KBrainShareStatus>(`/v1/sessions/${encodeURIComponent(conversationId)}/share`);
  }

  async function setShare(
    conversationId: string,
    input: { enabled: boolean; redact_tool_content?: boolean },
  ): Promise<KBrainShareStatus> {
    return request<KBrainShareStatus>(`/v1/sessions/${encodeURIComponent(conversationId)}/share`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async function resolveShareToken(token: string): Promise<KBrainSharedProjection> {
    return request<KBrainSharedProjection>(`/v1/shares/${encodeURIComponent(token)}`);
  }

  async function updateSession(
    conversationId: string,
    input: KBrainUpdateSessionRequest,
  ): Promise<KBrainSession> {
    return request<KBrainSession>(`/v1/sessions/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async function generateText(
    input: KBrainTextGenerateRequest,
    signal?: AbortSignal,
  ): Promise<KBrainTextGenerateResponse> {
    const result = await request<KBrainTextGenerateResponse>("/v1/text/generate", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
    if (result.version !== KBRAIN_PROTOCOL_VERSION || typeof result.text !== "string") {
      throw new Error("Malformed K-brain text-generation response");
    }
    if (
      result.model?.provider !== input.model.provider ||
      result.model?.model !== input.model.model
    ) {
      throw new Error("K-brain text-generation model identity mismatch");
    }
    return result;
  }

  async function startRun(input: KBrainPromptRequest): Promise<KBrainRunAccepted> {
    const accepted = await request<KBrainRunAccepted>(
      `/v1/sessions/${encodeURIComponent(input.conversation_id)}/runs`,
      { method: "POST", body: JSON.stringify(input) },
    );
    if (accepted.version !== KBRAIN_PROTOCOL_VERSION) {
      throw new Error(`Unsupported K-brain protocol ${String(accepted.version)}`);
    }
    if (
      accepted.conversation_id !== input.conversation_id ||
      !accepted.run_id ||
      !Number.isSafeInteger(accepted.accepted_seq) ||
      accepted.accepted_seq < 1
    ) {
      throw new Error("Malformed K-brain run acceptance");
    }
    return accepted;
  }

  async function cancelRun(conversationId: string, runId: string): Promise<void> {
    await request<unknown>(
      `/v1/sessions/${encodeURIComponent(conversationId)}/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST", body: JSON.stringify({ conversation_id: conversationId, run_id: runId }) },
    );
  }

  async function closeSession(conversationId: string): Promise<void> {
    await request<unknown>(`/v1/sessions/${encodeURIComponent(conversationId)}/close`, {
      method: "POST",
      body: JSON.stringify({ conversation_id: conversationId }),
    });
  }

  async function resolvePermission(
    conversationId: string,
    permissionId: string,
    decision: "allow_once" | "allow_always" | "reject",
    runId = "",
    reason?: string,
  ): Promise<void> {
    await request<unknown>(
      `/v1/sessions/${encodeURIComponent(conversationId)}/permissions/${encodeURIComponent(permissionId)}`,
      {
        method: "POST",
        body: JSON.stringify({
          conversation_id: conversationId,
          run_id: runId,
          decision: { permission_id: permissionId, decision, ...(reason ? { reason } : {}) },
        }),
      },
    );
  }

  async function subscribe(
    conversationId: string,
    afterSeq: number,
    handlers: KBrainEventHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetchImpl(
      `${baseUrl}/v1/sessions/${encodeURIComponent(conversationId)}/events?after_seq=${encodeURIComponent(String(afterSeq))}`,
      {
        headers: { ...headers(), Accept: "text/event-stream" },
        signal,
      },
    );
    if (!response.ok) throw await readError(response);
    if (!response.body) throw new Error("K-brain event stream has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastSeq = afterSeq;
    const abortReader = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener("abort", abortReader, { once: true });
    const consume = (record: string) => {
      let data = "";
      for (const line of record.split(/\r?\n/)) {
        if (line.startsWith("data:")) data += line.slice(5).trimStart();
      }
      if (!data) return;
      try {
        const event = JSON.parse(data) as KBrainEvent;
        if (event.version !== KBRAIN_PROTOCOL_VERSION) {
          throw new Error(`Unsupported K-brain protocol ${String(event.version)}`);
        }
        if (event.conversation_id !== conversationId) {
          throw new Error("K-brain event belongs to a different conversation");
        }
        if (!Number.isSafeInteger(event.seq) || event.seq !== lastSeq + 1) {
          throw new Error(
            `Malformed K-brain event sequence: expected ${lastSeq + 1}, got ${String(event.seq)}`,
          );
        }
        lastSeq = event.seq;
        handlers.onEvent(event);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        handlers.onError?.(normalized);
        throw normalized;
      }
    };
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const records = buffer.split(/\r?\n\r?\n/);
        buffer = records.pop() ?? "";
        for (const record of records) consume(record);
      }
      buffer += decoder.decode();
      if (buffer.trim()) throw new Error("K-brain event stream ended with an incomplete event");
    } finally {
      signal?.removeEventListener("abort", abortReader);
      reader.releaseLock();
    }
  }

  return {
    createSession,
    listSessions,
    listModels,
    generateText,
    getSession,
    updateSession,
    startRun,
    cancelRun,
    closeSession,
    resolvePermission,
    getHistory,
    branchSession,
    editSession,
    deleteSession,
    getShare,
    setShare,
    resolveShareToken,
    subscribe,
  };
}

export type KBrainClient = ReturnType<typeof createKBrainClient>;
