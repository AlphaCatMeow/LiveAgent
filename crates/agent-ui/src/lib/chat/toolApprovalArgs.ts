// 工具审批的网关同步契约:桌面端在同步给 WebUI 的工具参数上盖“待审批 + 截止
// 时间”标记(见 gatewayToolPreview),WebUI 据此渲染审批卡片并显示倒计时。
// 这些是 __ 前缀的合成参数,不参与展示(见 toolCallArgsForDisplay 过滤),也不
// 影响本地工具执行(执行用真实 arguments,非网关预览副本)。
// 本文件是两端共用的参数协议真源。

/** 工具调用正等待用户审批(真时 WebUI 渲染审批卡片)。 */
export const TOOL_APPROVAL_PENDING_ARG = "__toolApprovalPending";
/** 权威审批截止时间戳(毫秒);WebUI 倒计时与桌面计时同源。 */
export const TOOL_APPROVAL_DEADLINE_ARG = "__toolApprovalDeadlineAt";
/** 待审批工具的命令/参数摘要(桌面端算一次同步给 WebUI,审批栏统一展示)。 */
export const TOOL_APPROVAL_SUMMARY_ARG = "__toolApprovalSummary";
/** 后端会记住 approve_session 时为 true;缺省不提供"本会话始终允许"。 */
export const TOOL_APPROVAL_ALLOW_SESSION_ARG = "__toolApprovalAllowSession";
/** approve_session 生效的授权范围(如 computer_exec 的 call:click)。 */
export const TOOL_APPROVAL_SESSION_SCOPE_ARG = "__toolApprovalSessionScope";
/** 本次允许即对本会话同类操作生效(如 Computer Use);审批栏据此在批准前说明。 */
export const TOOL_APPROVAL_SESSION_WIDE_ARG = "__toolApprovalSessionWide";

/** 审批决定:allow=本次放行;deny=本次拒绝;approve_session=请后端在本对话内记住这条授权范围。 */
export type ToolApprovalDecision = "approve" | "deny" | "approve_session";

export function readToolApprovalPending(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  return (args as Record<string, unknown>)[TOOL_APPROVAL_PENDING_ARG] === true;
}

export function readToolApprovalDeadlineAt(args: unknown): number | null {
  if (!args || typeof args !== "object") return null;
  const value = (args as Record<string, unknown>)[TOOL_APPROVAL_DEADLINE_ARG];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 远端审批栏的一项;与桌面审批栏 PendingApprovalItem 同形。 */
export type RemoteToolApprovalItem = {
  toolCallId: string;
  toolName: string;
  summary?: string;
  deadlineAt?: number;
  allowSession: boolean;
  sessionScope?: string;
  sessionWide: boolean;
};

/** 从同步过来的工具调用参数还原待审批项;未待审批时返回 null。两个 WebUI 收集器共用。 */
export function pendingToolApprovalFromToolCall(toolCall: {
  id: string;
  name: string;
  arguments?: unknown;
}): RemoteToolApprovalItem | null {
  const args = toolCall.arguments;
  if (!readToolApprovalPending(args)) return null;
  const record = args as Record<string, unknown>;
  const scope = record[TOOL_APPROVAL_SESSION_SCOPE_ARG];
  return {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    summary: readToolApprovalSummary(args),
    deadlineAt: readToolApprovalDeadlineAt(args) ?? undefined,
    allowSession: record[TOOL_APPROVAL_ALLOW_SESSION_ARG] === true,
    sessionScope: typeof scope === "string" && scope.trim() ? scope.trim() : undefined,
    sessionWide: record[TOOL_APPROVAL_SESSION_WIDE_ARG] === true,
  };
}

export function readToolApprovalSummary(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[TOOL_APPROVAL_SUMMARY_ARG];
  return typeof value === "string" ? value : "";
}
