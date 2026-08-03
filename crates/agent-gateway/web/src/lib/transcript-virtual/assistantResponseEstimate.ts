import {
  getProcessDetailsDefaultOpen,
  partitionAssistantResponse,
  shouldForceProcessDetailsOpen,
} from "../chat/processDetailsModel";
import {
  type AssistantRowEstimateStats,
  estimateAssistantRowHeight,
  measureEstimateText,
} from "./rowEstimates";

type EstimableToolResult = {
  isError?: boolean;
  details?: unknown;
};

type EstimableToolItem = {
  toolCall?: { name?: string };
  toolResult?: EstimableToolResult;
};

export type EstimableAssistantBlock = {
  kind: string;
  text?: string;
  item?: unknown;
};

export type EstimableAssistantRound<TBlock extends EstimableAssistantBlock> = {
  blocks: readonly TBlock[];
  meta?: { stopReason?: unknown };
};

const FILE_CHANGE_TOOL_NAMES = new Set(["Write", "Edit", "Delete"]);

function addMarkdownEstimate(stats: AssistantRowEstimateStats, text: string) {
  const measured = measureEstimateText(text);
  stats.proseChars += measured.proseChars;
  stats.codeLines += measured.codeLines;
  stats.codeFences += measured.codeFences;
}

function addVisibleBlockEstimate(stats: AssistantRowEstimateStats, block: EstimableAssistantBlock) {
  if (block.kind === "text" || block.kind === "thinking") {
    addMarkdownEstimate(stats, block.text ?? "");
    return;
  }
  if (block.kind === "tool" || block.kind === "hostedSearch") {
    stats.toolCount += 1;
  }
}

function addArtifactReserve(
  stats: AssistantRowEstimateStats,
  rounds: readonly EstimableAssistantRound<EstimableAssistantBlock>[],
) {
  let hasChangedFilesCard = false;
  let displayImageCount = 0;

  for (const round of rounds) {
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      const item =
        block.item && typeof block.item === "object"
          ? (block.item as EstimableToolItem)
          : undefined;
      const { toolCall, toolResult } = item ?? {};
      if (!toolResult || toolResult.isError) continue;
      if (toolCall?.name && FILE_CHANGE_TOOL_NAMES.has(toolCall.name)) {
        hasChangedFilesCard = true;
      }
      const details = toolResult.details;
      if (
        details &&
        typeof details === "object" &&
        (details as { kind?: unknown }).kind === "display_image"
      ) {
        displayImageCount += 1;
      }
    }
  }

  // Both artifacts stay outside the process disclosure. Express their rough
  // height as extra collapsed-row equivalents so closing process details does
  // not make the virtualizer forget content that remains visible.
  if (hasChangedFilesCard) stats.toolCount += 4;
  stats.toolCount += displayImageCount * 7;
}

export function estimateAssistantResponseRowHeight<
  TBlock extends EstimableAssistantBlock,
  TRound extends EstimableAssistantRound<TBlock>,
>(rounds: readonly TRound[], expandProcessDetailsByDefault: boolean): number {
  const partition = partitionAssistantResponse<TBlock, TRound>(rounds);
  const stats: AssistantRowEstimateStats = {
    proseChars: 0,
    codeLines: 0,
    codeFences: 0,
    toolCount: partition.hasProcessDetails ? 1 : 0,
    thinkingCount: 0,
  };
  const processDetailsOpen =
    shouldForceProcessDetailsOpen(rounds) ||
    getProcessDetailsDefaultOpen({
      hasSubstantiveAnswer: partition.hasSubstantiveAnswer,
      expandByDefault: expandProcessDetailsByDefault,
    });

  if (processDetailsOpen) {
    for (const { blocks } of partition.processRounds) {
      for (const block of blocks) addVisibleBlockEstimate(stats, block);
    }
  }
  for (const { blocks } of partition.answerRounds) {
    for (const block of blocks) addVisibleBlockEstimate(stats, block);
  }
  addArtifactReserve(stats, rounds);

  return estimateAssistantRowHeight(stats);
}
