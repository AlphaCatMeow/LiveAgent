import { toast } from "@liveagent/ui/components/ui/toast-manager";
import { publishGoalState } from "./goalStore";
import type { KBrainGoalState } from "./types";

/**
 * 目标进度提示：同一对话共用一个 toast id，续跑轮次原地更新；达成、暂停、清除
 * 换成对应文案。轮次本身作为用户消息出现在转录区。
 */
export function showGoalProgress(
  conversationId: string,
  state: KBrainGoalState,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  // 目标栏持续显示进行中/暂停的目标；toast 只提示达成和非用户触发的暂停。
  publishGoalState(conversationId, state);
  const id = `goal-${conversationId}`;
  const goal = state.goal.length > 80 ? `${state.goal.slice(0, 80)}…` : state.goal;
  switch (state.status) {
    case "active":
    case "continuing":
    case "cleared":
      return;
    case "met":
      toast.success(t("chat.goal.met"), { id, description: goal, duration: 10_000 });
      return;
    case "paused":
      if (state.reason === "user") return;
      toast.warning(t("chat.goal.paused"), {
        id,
        description: goal,
        duration: 15_000,
      });
      return;
  }
}
