import { memo, useMemo } from "react";
import { ChangedFilesCard } from "../../components/chat/ChangedFilesCard";
import { collectChangedFiles } from "../../lib/chat/changedFiles";
import type { ChatFileLink } from "../../lib/chat/chatFileLinks";
import {
  partitionAssistantResponse,
  shouldForceProcessDetailsOpen,
} from "../../lib/chat/processDetailsModel";
import type { UiRound } from "../../lib/chat/uiMessages";
import { AssistantAvatar } from "./assistant-bubble/AssistantAvatar";
import { isBuiltinShareToolName } from "./assistant-bubble/assistantBubbleUtils";
import { ProcessDetailsDisclosure } from "./assistant-bubble/ProcessDetailsDisclosure";
import { RoundContent } from "./assistant-bubble/RoundContent";
import {
  getNativeDisplayImagePayload,
  NativeDisplayImageBlock,
} from "./assistant-bubble/ToolImages";

export { AssistantAvatar } from "./assistant-bubble/AssistantAvatar";
export { RetryDetailsBlock } from "./assistant-bubble/RoundContent";
export { AssistantStatus, CompactingText, VibingText } from "./assistant-bubble/StatusText";

const EMPTY_RUNNING_TOOL_CALL_IDS: string[] = [];

type AssistantBubbleRound = UiRound & {
  key?: string;
  runningToolCallIds?: string[];
  thinkingOpen?: boolean;
};

export const AssistantBubble = memo(function AssistantBubble(props: {
  disclosureKey: string;
  rounds: AssistantBubbleRound[];
  showUsage?: boolean;
  usageContextWindow?: number;
  isLive?: boolean;
  // Whether the stream is actively receiving tokens. Defaults to `isLive` —
  // when the article is in the live snapshot after `done`, set this to `false`
  // so the caret hides while the structural live state (thinking expansion,
  // tool indicators, streaming mode) stays intact and the article does not
  // re-render in static mode.
  isStreaming?: boolean;
  // Fixed Streamdown render mode for every round in this bubble: live-born
  // entries keep "streaming" forever (even after they fold into committed
  // history), history-born entries render "static". Never flips per entry.
  renderMode?: "streaming" | "static";
  toolStatus?: string | null;
  toolStatusVariant?: "default" | "compaction";
  readOnly?: boolean;
  redactToolContent?: boolean;
  processDetailsExpanded: boolean;
  workdir?: string;
  onOpenFileLink?: (link: ChatFileLink) => void;
}) {
  const {
    disclosureKey,
    rounds,
    showUsage,
    usageContextWindow,
    isLive,
    isStreaming = isLive,
    renderMode,
    toolStatus,
    toolStatusVariant,
    readOnly = false,
    redactToolContent = false,
    processDetailsExpanded,
    workdir,
    onOpenFileLink,
  } = props;
  const latestTodoItem = useMemo(() => {
    for (let roundIndex = rounds.length - 1; roundIndex >= 0; roundIndex -= 1) {
      const blocks = rounds[roundIndex]?.blocks ?? [];
      for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
        const block = blocks[blockIndex];
        if (block?.kind === "tool" && block.item.toolCall.name === "TodoWrite") {
          return block.item;
        }
      }
    }
    return null;
  }, [rounds]);
  const isAborted = useMemo(
    () => rounds.some((round) => round.meta?.stopReason === "aborted"),
    [rounds],
  );
  const forceProcessDetailsOpen = useMemo(() => shouldForceProcessDetailsOpen(rounds), [rounds]);
  // 回复末尾的已编辑文件卡：聚合整条回复所有 round 的 Write/Edit/Delete，
  // 只在回复结束（流停止）后出现；脱敏视图（分享页隐藏工具内容）不渲染。
  const changedFiles = useMemo(
    () => (isStreaming || redactToolContent ? null : collectChangedFiles(rounds)),
    [isStreaming, redactToolContent, rounds],
  );
  const presentation = useMemo(() => {
    const partition = partitionAssistantResponse<UiRound["blocks"][number], AssistantBubbleRound>(
      rounds,
    );
    const answerRoundSet = new Set(partition.answerRounds.map((entry) => entry.round));
    return {
      ...partition,
      processRounds: partition.processRounds.map((entry) => ({
        ...entry,
        displayRound: { ...entry.round, blocks: entry.blocks },
        showUsage: !answerRoundSet.has(entry.round),
      })),
      answerRounds: partition.answerRounds.map((entry) => ({
        ...entry,
        displayRound: { ...entry.round, blocks: entry.blocks },
      })),
    };
  }, [rounds]);
  const lastRound = rounds.at(-1);
  const displayImages = useMemo(
    () =>
      presentation.processRounds.flatMap(({ round, blocks }) =>
        blocks.flatMap((block, blockIndex) => {
          if (block.kind !== "tool") return [];
          if (redactToolContent && isBuiltinShareToolName(block.item.toolCall.name)) return [];
          const payload = getNativeDisplayImagePayload(block.item);
          if (!payload) return [];
          const roundKey = round.key || `round-${round.round}`;
          const toolKey = block.item.toolCall.id?.trim() || `${roundKey}-image-${blockIndex}`;
          return [{ key: toolKey, payload }];
        }),
      ),
    [presentation.processRounds, redactToolContent],
  );

  return (
    <div className="assistant-bubble-shell flex w-full max-w-full items-start gap-3">
      <AssistantAvatar className="assistant-bubble-avatar" />
      <div className="assistant-bubble-content min-w-0 flex-1 space-y-2 pt-0.5">
        {presentation.hasProcessDetails ? (
          <ProcessDetailsDisclosure
            disclosureKey={disclosureKey}
            hasSubstantiveAnswer={presentation.hasSubstantiveAnswer}
            expandByDefault={processDetailsExpanded}
            forceOpen={forceProcessDetailsOpen}
          >
            {() =>
              presentation.processRounds.map(
                ({ round, displayRound, showUsage: roundShowUsage }) => {
                  const active = Boolean(isLive && round === lastRound);
                  return (
                    <RoundContent
                      key={`process-${round.key || round.round}`}
                      round={displayRound}
                      showUsage={showUsage && roundShowUsage}
                      usageContextWindow={usageContextWindow}
                      isLive={isLive}
                      isStreaming={isStreaming}
                      isActive={active}
                      renderMode={renderMode}
                      toolStatus={active && !presentation.hasSubstantiveAnswer ? toolStatus : null}
                      toolStatusVariant={
                        active && !presentation.hasSubstantiveAnswer ? toolStatusVariant : "default"
                      }
                      runningToolCallIds={round.runningToolCallIds ?? EMPTY_RUNNING_TOOL_CALL_IDS}
                      thinkingOpen={round.thinkingOpen}
                      readOnly={readOnly}
                      redactToolContent={redactToolContent}
                      latestTodoItem={latestTodoItem}
                      isAborted={isAborted}
                      withinProcessDetails
                      workdir={workdir}
                      onOpenFileLink={onOpenFileLink}
                    />
                  );
                },
              )
            }
          </ProcessDetailsDisclosure>
        ) : null}

        {displayImages.map(({ key, payload }) => (
          <NativeDisplayImageBlock
            key={`${key}:display-image`}
            payload={payload}
            readOnly={readOnly}
          />
        ))}

        {presentation.answerRounds.map(({ round, displayRound }) => {
          const active = Boolean(isLive && round === lastRound);
          return (
            <RoundContent
              key={`answer-${round.key || round.round}`}
              round={displayRound}
              showUsage={showUsage}
              usageContextWindow={usageContextWindow}
              isLive={isLive}
              isStreaming={isStreaming}
              isActive={active}
              renderMode={renderMode}
              toolStatus={active && presentation.hasSubstantiveAnswer ? toolStatus : null}
              toolStatusVariant={
                active && presentation.hasSubstantiveAnswer ? toolStatusVariant : "default"
              }
              runningToolCallIds={round.runningToolCallIds ?? EMPTY_RUNNING_TOOL_CALL_IDS}
              thinkingOpen={round.thinkingOpen}
              readOnly={readOnly}
              redactToolContent={redactToolContent}
              latestTodoItem={latestTodoItem}
              isAborted={isAborted}
              workdir={workdir}
              onOpenFileLink={onOpenFileLink}
            />
          );
        })}
        {changedFiles ? <ChangedFilesCard summary={changedFiles} /> : null}
      </div>
    </div>
  );
});
