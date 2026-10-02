import type { SkillsResourceAdapter } from "@liveagent/ui/lib/resourceHost";
import { normalizeClawHubSkillCard } from "@liveagent/ui/lib/skills/clawHub";
import type { SystemManageSkillResponse } from "@liveagent/ui/lib/skills/index";
import { getKBrainRuntimeConnection } from "../lib/kbrain/runtimeConnection";

/** Resource-page seam for K-brain-managed Skills. */
export function createKbrainSkillsAdapter(fetchImpl: typeof fetch = fetch): SkillsResourceAdapter {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const connection = getKBrainRuntimeConnection();
    if (!connection) throw new Error("K-brain backend connection is not ready");
    const response = await fetchImpl(`${connection.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(
        (await response.text()) || `K-brain skills request failed (${response.status})`,
      );
    }
    return response.json() as Promise<T>;
  };

  return {
    list: async (workdir) => {
      const result = await request<Awaited<ReturnType<SkillsResourceAdapter["list"]>>>(
        `/v1/skills${workdir ? `?workdir=${encodeURIComponent(workdir)}` : ""}`,
      );
      if (
        typeof result.rootDir !== "string" ||
        !Array.isArray(result.skills) ||
        typeof result.settings?.enabled !== "boolean" ||
        !Array.isArray(result.settings.selected)
      )
        throw new Error("Invalid K-brain skills list response");
      return result;
    },
    manage: async (body) => {
      const result = await request<SystemManageSkillResponse>("/v1/skills/manage", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (result.installJob?.phase === "completed") result.installJob.phase = "done";
      if (result.external) {
        result.external = result.external.map((scan) => ({
          ...scan,
          tool:
            scan.tool === "skills"
              ? /(?:^|[\\/])\.claude[\\/]skills$/.test(scan.rootDir)
                ? "claude-code"
                : /(?:^|[\\/])\.codex[\\/]skills$/.test(scan.rootDir)
                  ? "codex"
                  : /(?:^|[\\/])\.agents[\\/]skills$/.test(scan.rootDir)
                    ? "agents"
                    : scan.rootDir
              : scan.tool,
          skills: scan.skills ?? [],
          errors: scan.errors ?? [],
        }));
      }
      return result;
    },
    settings: (body) =>
      request("/v1/skills/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    read: (path, offset = 0, length = 200) =>
      request(`/v1/skills/file?path=${encodeURIComponent(path)}&offset=${offset}&length=${length}`),
    storeSearch: async (params) => {
      const query = new URLSearchParams();
      if (params.query) query.set("q", params.query);
      if (params.cursor) query.set("cursor", params.cursor);
      if (params.ownerHandle) query.set("ownerHandle", params.ownerHandle);
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.sort) query.set("sort", params.sort);
      const result = await request<{ results: unknown[] | null; nextCursor?: string }>(
        `/v1/skills/store/search?${query}`,
      );
      if (result.results !== null && !Array.isArray(result.results)) {
        throw new Error("Invalid K-brain skills store response");
      }
      const items = (result.results ?? []).map((raw) => {
        const card = normalizeClawHubSkillCard(raw);
        if (!card) throw new Error("Invalid K-brain skills store item");
        return card;
      });
      return { items, nextCursor: result.nextCursor || null };
    },
    storeInstall: (body) =>
      request("/v1/skills/store/install", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  };
}

export const kbrainSkillsAdapter = createKbrainSkillsAdapter();
