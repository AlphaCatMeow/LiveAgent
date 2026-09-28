import { TrajectoryView } from "@liveagent/ui/components/trajectory/TrajectoryView";
import type { TrajectoryHost } from "@liveagent/ui/contracts/trajectory";
import { useLocale } from "@liveagent/ui/i18n/index";
import {
  toTrajectoryLiveAssistantMessage,
  toTrajectoryMessages,
} from "@liveagent/ui/lib/trajectory/transcriptMessages";
import { useMemo, useSyncExternalStore } from "react";
import type { RenderTimelineItem } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { isKBrainBackendEnabled } from "../../../lib/host";
import {
  desktopLiveTrajectoryEvents,
  desktopTrajectoryReloadVersion,
  subscribeDesktopLiveTrajectory,
} from "../../../lib/trajectory/liveTrajectory";

export function ConversationTrajectorySurface(props: {
  conversationId: string;
  host: TrajectoryHost;
  transcriptItems: readonly RenderTimelineItem[];
  liveTranscriptStore: LiveTranscriptStore;
  workdir?: string;
  hasMoreMessages: boolean;
  loadEarlierMessages: () => void | Promise<void>;
}) {
  const { locale } = useLocale();
  if (isKBrainBackendEnabled()) {
    return (
      <p className="p-4 text-sm text-muted-foreground" role="note">
        {locale === "zh-CN"
          ? "K-brain 模式尚不支持桌面轨迹视图；请在对话中查看后端工具调用与结果。"
          : "Desktop trajectory view is not supported in K-brain mode. Backend tool calls and results are available in the conversation."}
      </p>
    );
  }
  return <DesktopConversationTrajectorySurface {...props} />;
}

function DesktopConversationTrajectorySurface(
  props: Parameters<typeof ConversationTrajectorySurface>[0],
) {
  const persistedMessages = useMemo(
    () => toTrajectoryMessages(props.transcriptItems),
    [props.transcriptItems],
  );
  const liveTranscriptSnapshot = useSyncExternalStore(
    props.liveTranscriptStore.subscribe,
    props.liveTranscriptStore.getSnapshot,
  );
  const liveAssistantMessage = useMemo(
    () =>
      toTrajectoryLiveAssistantMessage(
        liveTranscriptSnapshot,
        `trajectory-live-${props.conversationId}`,
      ),
    [liveTranscriptSnapshot, props.conversationId],
  );
  const messages = useMemo(
    () =>
      liveAssistantMessage === undefined
        ? persistedMessages
        : [...persistedMessages, liveAssistantMessage],
    [liveAssistantMessage, persistedMessages],
  );
  const liveEvents = useSyncExternalStore(subscribeDesktopLiveTrajectory, () =>
    desktopLiveTrajectoryEvents(props.conversationId),
  );
  const authoritativeRevision = useSyncExternalStore(subscribeDesktopLiveTrajectory, () =>
    desktopTrajectoryReloadVersion(props.conversationId),
  );

  return (
    <TrajectoryView
      conversationId={props.conversationId}
      host={props.host}
      messages={messages}
      workdir={props.workdir}
      hasMoreMessages={props.hasMoreMessages}
      loadEarlierMessages={props.loadEarlierMessages}
      liveEvents={liveEvents}
      liveOwnership="authoritative"
      authoritativeRevision={authoritativeRevision}
    />
  );
}
