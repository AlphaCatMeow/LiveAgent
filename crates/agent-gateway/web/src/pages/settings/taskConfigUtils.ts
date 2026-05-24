import {
  canHookHttpMethodHaveBody,
  type HookHttpMethod,
  type HookHttpRequest,
} from "../../lib/settings";

export type TaskHttpRequestDraft = {
  id: string;
  url: string;
  method: HookHttpMethod;
  headersText: string;
  bodyText: string;
};

type HttpParseMessages = {
  required: string;
  urlRequired: (index: number) => string;
  urlInvalid: (index: number) => string;
  headersInvalid: string;
  bodyInvalid: string;
};

export function stringifyTaskHeaders(headers?: Record<string, string>) {
  if (!headers || Object.keys(headers).length === 0) return "";
  return JSON.stringify(headers, null, 2);
}

export function stringifyTaskBody(body?: unknown) {
  if (body === undefined) return "";
  return JSON.stringify(body, null, 2);
}

export function createEmptyTaskRequestDraft(): TaskHttpRequestDraft {
  return {
    id: crypto.randomUUID(),
    url: "",
    method: "POST",
    headersText: "",
    bodyText: "",
  };
}

export function taskRequestToDraft(request?: HookHttpRequest): TaskHttpRequestDraft {
  if (!request) return createEmptyTaskRequestDraft();
  return {
    id: request.id,
    url: request.url,
    method: request.method,
    headersText: stringifyTaskHeaders(request.headers),
    bodyText: stringifyTaskBody(request.body),
  };
}

function parseRequestHeaders(input: string, invalidMessage: string) {
  if (!input.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(invalidMessage);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(invalidMessage);
  }

  const headers: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const key = String(rawKey).trim();
    const value =
      typeof rawValue === "string" ? rawValue.trim() : String(rawValue ?? "").trim();
    if (!key || !value) continue;
    headers[key] = value;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function parseRequestBody(
  method: HookHttpMethod,
  input: string,
  invalidMessage: string,
) {
  if (!canHookHttpMethodHaveBody(method)) return undefined;
  if (!input.trim()) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    throw new Error(invalidMessage);
  }
}

export function parseHttpRequests(
  requests: TaskHttpRequestDraft[],
  messages: HttpParseMessages,
): HookHttpRequest[] {
  if (requests.length === 0) {
    throw new Error(messages.required);
  }

  return requests.map((request, index) => {
    const url = request.url.trim();
    if (!url) {
      throw new Error(messages.urlRequired(index));
    }
    try {
      new URL(url);
    } catch {
      throw new Error(messages.urlInvalid(index));
    }

    return {
      id: request.id,
      url,
      method: request.method,
      headers: parseRequestHeaders(request.headersText, messages.headersInvalid),
      body: parseRequestBody(request.method, request.bodyText, messages.bodyInvalid),
    } satisfies HookHttpRequest;
  });
}
