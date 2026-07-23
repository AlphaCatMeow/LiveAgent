import type { ProviderId } from "../../settings";
import { isRecord } from "./common";
import type { StreamOptionsEx } from "./types";

// xAI Responses 端点严格校验请求体：OpenAI 专属的存储/缓存/推理档位与系统
// 元数据字段（store、prompt_cache_*、reasoning、instructions、metadata 等）
// 不被接受，直连 api.x.ai 时必须整组剥离，仅保留 Responses 协议的公共字段。
const XAI_UNSUPPORTED_RESPONSES_PAYLOAD_KEYS = [
  "background",
  "instructions",
  "metadata",
  "prompt",
  "prompt_cache_key",
  "prompt_cache_retention",
  "reasoning",
  "service_tier",
  "store",
  "stream_options",
  "text",
] as const;

export function isXaiDirectBaseUrl(baseUrl: string | undefined): boolean {
  const trimmed = baseUrl?.trim() ?? "";
  if (!trimmed) return false;
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).hostname.toLowerCase() === "api.x.ai";
  } catch {
    return false;
  }
}

// grok 的服务端工具（web_search / x_search / code_interpreter）只有显式
// include 才会回传搜索来源与执行输出；reasoning.encrypted_content 则是
// store 关闭时跨轮回放推理项的前提，始终请求。
function xaiResponsesIncludeValues(tools: unknown): string[] {
  const values = ["reasoning.encrypted_content"];
  if (!Array.isArray(tools)) return values;
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.type !== "string") continue;
    switch (tool.type.trim()) {
      case "web_search":
        values.push("web_search_call.action.sources");
        break;
      case "file_search":
        values.push("file_search_call.results");
        break;
      case "code_interpreter":
        values.push("code_interpreter_call.outputs");
        break;
    }
  }
  return values;
}

function mergeUniqueIncludeValues(defaults: string[], existing: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  };
  for (const value of defaults) push(value);
  if (Array.isArray(existing)) {
    for (const value of existing) push(value);
  }
  return result;
}

export function attachXaiResponsesPayloadCompat(
  options: StreamOptionsEx,
  params: {
    providerId: ProviderId;
    baseUrl?: string;
  },
): StreamOptionsEx {
  if (params.providerId !== "codex" || !isXaiDirectBaseUrl(params.baseUrl)) {
    return options;
  }

  const previousOnPayload = options.onPayload;
  return {
    ...options,
    onPayload: async (payload, model) => {
      let nextPayload = payload;

      if (previousOnPayload) {
        const overridden = await previousOnPayload(nextPayload, model);
        if (overridden !== undefined) {
          nextPayload = overridden;
        }
      }

      if (model.api !== "openai-responses" || !isRecord(nextPayload)) {
        return nextPayload;
      }

      const sanitized: Record<string, unknown> = { ...nextPayload };
      for (const key of XAI_UNSUPPORTED_RESPONSES_PAYLOAD_KEYS) {
        delete sanitized[key];
      }
      sanitized.include = mergeUniqueIncludeValues(
        xaiResponsesIncludeValues(sanitized.tools),
        nextPayload.include,
      );
      return sanitized;
    },
  };
}
