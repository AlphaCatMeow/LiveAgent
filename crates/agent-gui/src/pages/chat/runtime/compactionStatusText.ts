import type { PreCompactionDecision } from "../../../lib/chat/compaction/contextCompaction";

export function buildPreCompactionStatus(decision: PreCompactionDecision) {
  if (decision.thresholdMode === "context-window") {
    return `上下文已达到窗口上限（判定 ${decision.effectiveTokens}/${decision.contextWindow} tokens），正在压缩历史...`;
  }
  return `上下文接近上限（判定 ${decision.effectiveTokens}/${decision.contextWindow} tokens），正在压缩历史...`;
}

export function buildProtectionCompactionStatus(decision: PreCompactionDecision) {
  if (decision.thresholdMode === "context-window") {
    return `上下文已达到窗口上限（判定 ${decision.effectiveTokens}/${decision.contextWindow} tokens），正在压缩并恢复...`;
  }
  return `上下文接近保护阈值（判定 ${decision.effectiveTokens}/${decision.contextWindow} tokens），正在压缩并恢复...`;
}
