import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  ASK_USER_QUESTION_MAX_OPTIONS,
  ASK_USER_QUESTION_MAX_QUESTIONS,
  ASK_USER_QUESTION_MIN_OPTIONS,
  ASK_USER_QUESTION_TIMEOUT_MS,
  ASK_USER_QUESTION_TOOL_NAME,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
  type AskUserQuestionResultDetails,
  buildAskUserQuestionResultText,
  buildDefaultAskUserQuestionAnswers,
  parseAskUserQuestionItems,
  resolveAskUserQuestionAnswers,
} from "../chat/askUserQuestion";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

type AskUserQuestionSettlement =
  | { kind: "answered"; answers: AskUserQuestionAnswer[] }
  | { kind: "timeout"; answers: AskUserQuestionAnswer[] }
  | { kind: "cancelled" };

type PendingAskUserQuestion = {
  conversationId: string;
  questions: AskUserQuestionItem[];
  settle: (settlement: AskUserQuestionSettlement) => void;
};

// 全局 pending 表（toolCallId 全局唯一）：本地卡片直接应答，WebUI 应答经
// gateway chat_queue.tool_answer 转发到桌面端后走同一入口。
const pendingByToolCallId = new Map<string, PendingAskUserQuestion>();

export type AnswerAskUserQuestionOutcome = { ok: boolean; message?: string };

/** 应答一个挂起的提问；answers 为 {questionId, selectedLabel}[] 的原始输入。 */
export function answerAskUserQuestion(
  toolCallId: string,
  rawAnswers: unknown,
): AnswerAskUserQuestionOutcome {
  const pending = pendingByToolCallId.get(toolCallId.trim());
  if (!pending) {
    return { ok: false, message: "Question is not pending (already answered or cancelled)." };
  }
  const answers = resolveAskUserQuestionAnswers(pending.questions, rawAnswers);
  if (!answers) {
    return { ok: false, message: "Every question needs one of its listed options selected." };
  }
  pending.settle({ kind: "answered", answers });
  return { ok: true };
}

export function hasPendingAskUserQuestion(toolCallId: string) {
  return pendingByToolCallId.has(toolCallId.trim());
}

/** 会话销毁兜底：挂起中的提问按“未应答”落定（正常路径由 AbortSignal 取消）。 */
export function cancelPendingAskUserQuestionsForConversation(conversationId: string) {
  for (const [toolCallId, pending] of pendingByToolCallId) {
    if (pending.conversationId === conversationId) {
      pendingByToolCallId.delete(toolCallId);
      pending.settle({ kind: "cancelled" });
    }
  }
}

const ASK_USER_QUESTION_TIMEOUT_MINUTES = Math.round(ASK_USER_QUESTION_TIMEOUT_MS / 60_000);

const ASK_USER_QUESTION_TOOL_DESCRIPTION = `Ask the user up to ${ASK_USER_QUESTION_MAX_QUESTIONS} multiple-choice questions and wait for their selections. Use this whenever you need a decision only the user can make: ambiguous requirements, mutually exclusive approaches, or trade-offs you cannot resolve from the conversation and the workspace.

The questions render as an interactive card; execution pauses until the user answers every question, then the selections come back as the tool result. If the user does not answer within ${ASK_USER_QUESTION_TIMEOUT_MINUTES} minutes, the recommended (or first) option of every question is auto-selected and execution continues — the result text tells you which happened.

Rules:
- Ask 1-${ASK_USER_QUESTION_MAX_QUESTIONS} focused questions per call; each question needs ${ASK_USER_QUESTION_MIN_OPTIONS}-${ASK_USER_QUESTION_MAX_OPTIONS} options (3-4 is ideal), and every question in one call must have the SAME number of options.
- Options must be short, concrete, and mutually exclusive. Set recommended=true on your suggested choice (at most one per question) — it is shown first and becomes the timeout fallback.
- Give each question a short header (2-6 chars works best) — it becomes the tab label when several questions show at once.
- Do not use this for questions answerable from the code or the conversation, and never ask for confirmation of work you can safely do.`;

const askUserQuestionParameters = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.Optional(
        Type.String({ description: "Stable question id (defaults to q1..qN by position)." }),
      ),
      header: Type.Optional(
        Type.String({ description: "Short tab label shown when multiple questions render." }),
      ),
      prompt: Type.String({ description: "The question shown to the user." }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ description: "Concise option label the user picks." }),
          description: Type.Optional(
            Type.String({ description: "One-line explanation of the trade-off." }),
          ),
          recommended: Type.Optional(
            Type.Boolean({
              description:
                "Mark exactly one option per question as your recommendation; it is shown first and auto-selected on timeout.",
            }),
          ),
        }),
        {
          description: `${ASK_USER_QUESTION_MIN_OPTIONS}-${ASK_USER_QUESTION_MAX_OPTIONS} mutually exclusive options (3-4 is ideal). Every question in one call must have the same number of options.`,
        },
      ),
    }),
    { description: `1-${ASK_USER_QUESTION_MAX_QUESTIONS} questions to ask in this card.` },
  ),
});

function buildErrorResult(toolCall: ToolCall, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    details: {},
    isError: true,
    timestamp: Date.now(),
  };
}

export function createAskUserQuestionTools(params: {
  conversationId: string;
  /** 应答窗口毫秒数；仅测试注入，生产始终用默认值。 */
  timeoutMs?: number;
}): BuiltinToolBundle {
  const timeoutMs = params.timeoutMs ?? ASK_USER_QUESTION_TIMEOUT_MS;
  const toolAskUserQuestion: Tool = {
    name: ASK_USER_QUESTION_TOOL_NAME,
    description: ASK_USER_QUESTION_TOOL_DESCRIPTION,
    parameters: askUserQuestionParameters,
  };

  async function executeToolCall(
    toolCall: ToolCall,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    if (toolCall.name !== ASK_USER_QUESTION_TOOL_NAME) {
      return buildErrorResult(toolCall, `Unknown tool: ${toolCall.name}`);
    }
    if (signal?.aborted) {
      return buildErrorResult(toolCall, "Cancelled");
    }

    let questions: AskUserQuestionItem[];
    try {
      const args = (toolCall.arguments || {}) as Record<string, unknown>;
      questions = parseAskUserQuestionItems(args.questions);
    } catch (error) {
      return buildErrorResult(
        toolCall,
        error instanceof Error ? error.message : "AskUserQuestion failed.",
      );
    }

    // 挂起等待用户在聊天卡片里作答；停止按钮（AbortSignal）以“未应答”落定，
    // 超过应答窗口则按推荐项（缺省第一项）自动落定继续执行。
    const settlement = await new Promise<AskUserQuestionSettlement>((resolve) => {
      const settle = (value: AskUserQuestionSettlement) => {
        pendingByToolCallId.delete(toolCall.id);
        signal?.removeEventListener("abort", onAbort);
        clearTimeout(timeoutId);
        resolve(value);
      };
      const onAbort = () => settle({ kind: "cancelled" });
      const timeoutId = setTimeout(
        () => settle({ kind: "timeout", answers: buildDefaultAskUserQuestionAnswers(questions) }),
        timeoutMs,
      );
      pendingByToolCallId.set(toolCall.id, {
        conversationId: params.conversationId,
        questions,
        settle,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });

    if (settlement.kind === "cancelled") {
      const details: AskUserQuestionResultDetails = {
        kind: "ask_user_question",
        questions,
        answers: [],
        cancelled: true,
      };
      return {
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: "The user stopped the turn without answering. Do not assume any selection.",
          },
        ],
        details,
        isError: true,
        timestamp: Date.now(),
      };
    }

    const timedOut = settlement.kind === "timeout";
    const details: AskUserQuestionResultDetails = {
      kind: "ask_user_question",
      questions,
      answers: settlement.answers,
      ...(timedOut ? { timedOut: true } : {}),
    };
    return {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [
        { type: "text", text: buildAskUserQuestionResultText(settlement.answers, { timedOut }) },
      ],
      details,
      isError: false,
      timestamp: Date.now(),
    };
  }

  return {
    groupId: "system",
    tools: [toolAskUserQuestion],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        ASK_USER_QUESTION_TOOL_NAME,
        {
          groupId: "system",
          kind: "ask_user_question",
          isReadOnly: true,
          displayCategory: "system",
        },
      ],
    ]),
  };
}
