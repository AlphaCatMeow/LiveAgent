// 平台传输适配层:GUI 端用量查询直接走 Tauri invoke,由桌面端执行 API-only 查询。
// 共享的状态归约/协调器/hook 逻辑在 usageQueryCore.ts(两端字节镜像),本文件只放平台差异。
import { invoke } from "@tauri-apps/api/core";
import {
  type ProviderUsageResult,
  type SelectedModel,
  type UsageQueryProvider,
  useProviderUsageWithQuery,
} from "./usageQueryCore";

export * from "./usageQueryCore";

export async function queryProviderUsage(
  providerId: string,
  refresh: boolean,
): Promise<ProviderUsageResult | null> {
  return invoke<ProviderUsageResult>("provider_usage_query", { providerId, refresh });
}

export function useProviderUsage(
  providers: readonly UsageQueryProvider[],
  selectedModel: SelectedModel,
) {
  return useProviderUsageWithQuery(queryProviderUsage, providers, selectedModel);
}
