import { resolveKBrainClientOptions } from "./runtimeConnection";
import type { KBrainClientOptions } from "./types";

export type KBrainAgentTemplate = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
};

export type KBrainPromptSnapshot = {
  version?: "kbrain.agent.v1";
  revision: number;
  globalTemplates: KBrainAgentTemplate[];
  globalPrompt?: string;
  projectPrompt: string;
  projectPromptStrategy: "append" | "replace";
  effectivePrompt?: string;
  projectPrompts?: Record<
    string,
    {
      workdir?: string;
      prompt?: string;
      strategy?: "append" | "replace";
    }
  >;
  files?: Array<{ name: string; description?: string; argumentHint?: string; path: string }>;
};

type PromptMutationResponse = {
  version?: "kbrain.agent.v1";
  revision: number;
  templates?: KBrainAgentTemplate[];
};

export type KBrainPromptClient = {
  get(workdir?: string): Promise<KBrainPromptSnapshot>;
  replaceTemplates(
    templates: KBrainAgentTemplate[],
    baseRevision?: number,
  ): Promise<PromptMutationResponse>;
  createTemplate(template: KBrainAgentTemplate): Promise<PromptMutationResponse>;
  patchTemplate(
    id: string,
    patch: Partial<Omit<KBrainAgentTemplate, "id">>,
  ): Promise<PromptMutationResponse>;
  deleteTemplate(id: string): Promise<PromptMutationResponse>;
  setProject(
    workdir: string,
    prompt: string,
    strategy: "append" | "replace",
  ): Promise<PromptMutationResponse>;
  expandMarkdown(
    name: string,
    args: string[],
    workdir?: string,
  ): Promise<{ name: string; text: string }>;
};

export function createKBrainPromptClient(
  inputOptions: KBrainClientOptions = {},
): KBrainPromptClient {
  const options = resolveKBrainClientOptions(inputOptions);
  const configuredBaseUrl =
    options.baseUrl?.trim() ?? (options.fetch ? "http://127.0.0.1:47321" : undefined);
  if (!configuredBaseUrl) throw new Error("K-brain backend connection is not ready");
  const baseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(options.token?.trim() ? { Authorization: `Bearer ${options.token.trim()}` } : {}),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        const parsed = JSON.parse(body) as { error?: string; message?: string };
        message = parsed.error ?? parsed.message ?? body;
      } catch {
        // Preserve non-JSON backend errors.
      }
      throw Object.assign(
        new Error(message || `K-brain prompt request failed (${response.status})`),
        {
          status: response.status,
        },
      );
    }
    return (await response.json()) as T;
  }

  function promptPath(workdir?: string): string {
    if (!workdir?.trim()) return "/v1/prompts";
    return `/v1/prompts?workdir=${encodeURIComponent(workdir.trim())}`;
  }

  return {
    get: (workdir) => request<KBrainPromptSnapshot>(promptPath(workdir)),
    replaceTemplates: (templates, baseRevision) =>
      request<PromptMutationResponse>("/v1/prompts/templates", {
        method: "PUT",
        body: JSON.stringify({
          templates,
          ...(baseRevision === undefined ? {} : { baseRevision }),
        }),
      }),
    createTemplate: (template) =>
      request<PromptMutationResponse>("/v1/prompts/templates", {
        method: "POST",
        body: JSON.stringify(template),
      }),
    patchTemplate: (id, patch) =>
      request<PromptMutationResponse>(`/v1/prompts/templates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    deleteTemplate: (id) =>
      request<PromptMutationResponse>(`/v1/prompts/templates/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    setProject: (workdir, prompt, strategy) =>
      request<PromptMutationResponse>("/v1/prompts/project", {
        method: "PUT",
        body: JSON.stringify({ workdir, prompt, strategy }),
      }),
    expandMarkdown: async (name, args, workdir) => {
      const query = workdir?.trim() ? `?workdir=${encodeURIComponent(workdir.trim())}` : "";
      return request<{ name: string; text: string }>(
        `/v1/prompts/templates/${encodeURIComponent(name)}/expand${query}`,
        { method: "POST", body: JSON.stringify({ args }) },
      );
    },
  };
}
