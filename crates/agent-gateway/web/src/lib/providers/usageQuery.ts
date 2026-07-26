// 平台传输适配层:WebUI 端用量查询经 Gateway WebSocket 桥接到桌面端执行(provider.usage.query)。
// 共享的状态归约/协调器/hook 逻辑在 usageQueryCore.ts(两端字节镜像),本文件只放平台差异。
import { getGatewayWebSocketClient } from "@/lib/gatewaySocket";
import { loadToken } from "@/lib/storage";
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
  return getGatewayWebSocketClient(
    loadToken().trim(),
  ).providerUsageQuery<ProviderUsageResult | null>(providerId, refresh);
}

export function useProviderUsage(
  providers: readonly UsageQueryProvider[],
  selectedModel: SelectedModel,
) {
  return useProviderUsageWithQuery(queryProviderUsage, providers, selectedModel);
}
