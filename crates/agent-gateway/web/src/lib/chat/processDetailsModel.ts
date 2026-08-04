export type AssistantResponseBlockLike = {
  kind: string;
  text?: string;
  item?: unknown;
};

export type AssistantResponseRoundLike = {
  blocks: readonly AssistantResponseBlockLike[];
  meta?: { stopReason?: unknown };
};

export type PartitionedAssistantRound<TRound, TBlock> = {
  round: TRound;
  blocks: TBlock[];
};

export type AssistantResponsePartition<TRound, TBlock> = {
  processRounds: PartitionedAssistantRound<TRound, TBlock>[];
  answerRounds: PartitionedAssistantRound<TRound, TBlock>[];
  hasProcessDetails: boolean;
  hasSubstantiveAnswer: boolean;
};

export type PartitionAssistantResponseOptions = {
  preserveStreamingText?: boolean;
};

export function isProcessDetailsBlock(block: AssistantResponseBlockLike): boolean {
  return block.kind === "thinking" || block.kind === "tool" || block.kind === "hostedSearch";
}

export function partitionAssistantResponse<
  TBlock extends AssistantResponseBlockLike,
  TRound extends { blocks: readonly TBlock[] },
>(
  rounds: readonly TRound[],
  options: PartitionAssistantResponseOptions = {},
): AssistantResponsePartition<TRound, TBlock> {
  let blockPosition = 0;
  let lastProcessPosition = -1;

  for (const round of rounds) {
    for (const block of round.blocks) {
      if (isProcessDetailsBlock(block)) {
        lastProcessPosition = blockPosition;
      }
      blockPosition += 1;
    }
  }

  const processRounds: PartitionedAssistantRound<TRound, TBlock>[] = [];
  const answerRounds: PartitionedAssistantRound<TRound, TBlock>[] = [];
  let hasSubstantiveAnswer = false;
  blockPosition = 0;

  for (const round of rounds) {
    const processBlocks: TBlock[] = [];
    const answerBlocks: TBlock[] = [];

    for (const block of round.blocks) {
      if (
        blockPosition <= lastProcessPosition &&
        !(options.preserveStreamingText && block.kind === "text")
      ) {
        processBlocks.push(block);
      } else {
        answerBlocks.push(block);
        if (block.kind === "text" && /\S/.test(block.text ?? "")) {
          hasSubstantiveAnswer = true;
        }
      }
      blockPosition += 1;
    }

    if (processBlocks.length > 0) {
      processRounds.push({ round, blocks: processBlocks });
    }
    if (answerBlocks.length > 0) {
      answerRounds.push({ round, blocks: answerBlocks });
    }
  }

  return {
    processRounds,
    answerRounds,
    hasProcessDetails: lastProcessPosition >= 0,
    hasSubstantiveAnswer,
  };
}

export function getProcessDetailsDefaultOpen(input: {
  hasSubstantiveAnswer: boolean;
  expandByDefault: boolean;
}): boolean {
  return !input.hasSubstantiveAnswer || input.expandByDefault;
}

export function shouldForceProcessDetailsOpen(
  rounds: readonly AssistantResponseRoundLike[],
): boolean {
  const { hasSubstantiveAnswer } = partitionAssistantResponse(rounds);

  for (const round of rounds) {
    const stopReason = round.meta?.stopReason;
    if (stopReason === "aborted" || stopReason === "error") return true;

    for (const block of round.blocks) {
      if (block.kind !== "tool" || !block.item || typeof block.item !== "object") continue;
      const toolResult = (block.item as { toolResult?: unknown }).toolResult;
      if (!toolResult || typeof toolResult !== "object") continue;
      const result = toolResult as { isError?: unknown; details?: unknown };
      // A tool-level error can be recovered by a later tool call. Once a
      // substantive answer exists, that recovered error must not override the
      // user's disclosure preference. Without an answer, keep the failure
      // visible even if the user collapsed the active process manually.
      if (result.isError === true && !hasSubstantiveAnswer) return true;
      if (
        result.details &&
        typeof result.details === "object" &&
        (result.details as { timedOut?: unknown }).timedOut === true
      ) {
        return true;
      }
    }
  }
  return false;
}
