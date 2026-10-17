import type { ComposerTurnCommand } from "@liveagent/ui/lib/chat/composerCommands";
import type { ChatRuntimeControls } from "@/lib/settings";
import type { SendChatFn } from "./types";

/**
 * WebUI 的“/”指令发送一轮：把指令语义映射成聊天请求字段。发送没有被接受
 * （会话已有待确认的请求、没有连接或请求失败）时抛错，输入框据此保留草稿并
 * 显示原因，而不是静默吞掉指令。
 */
export async function sendComposerCommandTurn(
  sendChat: SendChatFn,
  t: (key: string) => string,
  text: string,
  command: ComposerTurnCommand | undefined,
  options: { conversationId?: string; runtimeControls?: ChatRuntimeControls } = {},
) {
  const outcome = await sendChat(text, {
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    goalAction: command?.kind === "goal" ? command.action : undefined,
    goalText: command?.kind === "goal" && command.action === "set" ? command.goal : undefined,
    promptCommand: command?.kind === "prompt" ? true : undefined,
    runtimeControls: options.runtimeControls,
  });
  if (outcome === null) throw new Error(t("chat.commands.busy"));
  if (outcome.kind === "failed") throw new Error(outcome.message || t("chat.commands.failed"));
  return outcome;
}
