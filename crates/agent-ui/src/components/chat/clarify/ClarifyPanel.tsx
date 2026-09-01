// crates/agent-ui/src/components/chat/clarify/ClarifyPanel.tsx
import { Loader2, RefreshCw, WandSparkles, X } from "@liveagent/ui/components/IconSet";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { isClarifyListFollowing, pinClarifyListIfFollowing } from "./clarifyPanelScroll";
import { stripLeadingMarker } from "./clarifyProtocol";
import type { ClarifySessionState } from "./useClarifySession";

type ClarifyPanelProps = {
  state: ClarifySessionState;
  busy: boolean;
  onSubmitAnswer: (text: string) => void;
  onForceFinal: () => void;
  onRetry: () => void;
  onClose: () => void;
};

/** 浮在输入卡片正上方的澄清面板：问答气泡 + 回答输入行 + 操作按钮。 */
export function ClarifyPanel(props: ClarifyPanelProps) {
  const { state, busy, onSubmitAnswer, onForceFinal, onRetry, onClose } = props;
  const { t } = useLocale();
  const [answer, setAnswer] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // 流式增量必须在绘制前钉底，否则最新行会闪一帧裁切。max-h 钳制后滚动
  // 容器自身不再长高，ResizeObserver 盯内部内容盒（换行/页脚挤占）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 问答/流式/状态是钉底触发信号，effect 体只写 scrollTop。
  useLayoutEffect(() => {
    pinClarifyListIfFollowing(listRef.current, followRef.current);
  }, [state.visibleMessages, state.streamingText, state.status, state.error, busy]);

  useLayoutEffect(() => {
    const viewport = listRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const content = viewport.firstElementChild;
    const observer = new ResizeObserver(() => {
      pinClarifyListIfFollowing(viewport, followRef.current);
    });
    observer.observe(viewport);
    if (content instanceof Element) observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const submit = () => {
    const text = answer.trim();
    if (!text || busy) return;
    setAnswer("");
    onSubmitAnswer(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const canAnswer = state.status === "awaitingInput";
  const canGenerate = !busy && state.status !== "done";

  return (
    // 独立浮层：宽度与队列面板对齐（左右各收 0.75rem），与输入卡片留出
    // 1.5rem 间隙——卡片上缘是 rounded-3xl 圆角，贴合式（border-b-0 +
    // mb-[-1px]）只适合队列那种直角底边。shrink-0 兜展开态——外层列是
    // flex-col justify-end，卡片 flex-1 吸收伸缩，面板高度只受 max-h-[40vh]
    // 钳制，不参与压缩。
    <div
      data-clarify-panel=""
      className="relative z-30 mx-auto mb-1.5 flex max-h-[40vh] min-h-0 w-[calc(100%-1.5rem)] max-w-[720px] shrink-0 flex-col overflow-hidden rounded-2xl border border-black/[0.055] bg-white/80 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.24),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-2xl backdrop-saturate-[165%] dark:border-white/[0.10] dark:bg-white/[0.06] dark:shadow-[0_8px_24px_-18px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[calc(11px*var(--zone-font-scale,1))] font-medium text-muted-foreground">
          <WandSparkles className="h-3.5 w-3.5" />
          {t("chat.clarify.title")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("chat.clarify.close")}
          title={t("chat.clarify.close")}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div
        ref={listRef}
        data-clarify-messages=""
        className="chat-queue-scroll min-h-0 overflow-y-auto px-3 pb-2 [overflow-anchor:none]"
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          followRef.current = isClarifyListFollowing(el);
        }}
      >
        <div className="flex flex-col gap-1.5">
          {state.visibleMessages.map((message, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 问答消息无唯一标识（role+内容可重复）；会话内列表只追加不重排，索引 key 稳定唯一。
              key={index}
              className={cn(
                "max-w-[92%] whitespace-pre-wrap rounded-xl px-2.5 py-1.5 text-[calc(12px*var(--zone-font-scale,1))] leading-relaxed",
                message.role === "user"
                  ? "self-end bg-primary/10 text-foreground"
                  : "self-start bg-muted/60 text-foreground/90",
              )}
            >
              {message.role === "assistant" ? stripLeadingMarker(message.content) : message.content}
            </div>
          ))}
          {busy && state.streamingText ? (
            <div className="max-w-[92%] self-start whitespace-pre-wrap rounded-xl bg-muted/60 px-2.5 py-1.5 text-[calc(12px*var(--zone-font-scale,1))] leading-relaxed text-foreground/90">
              {stripLeadingMarker(state.streamingText)}
            </div>
          ) : null}
          {state.status === "asking" && !state.streamingText ? (
            <div className="flex items-center gap-1.5 self-start rounded-xl bg-muted/60 px-2.5 py-1.5 text-[calc(12px*var(--zone-font-scale,1))] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("chat.clarify.thinking")}
            </div>
          ) : null}
          {state.status === "error" && state.error ? (
            <div className="flex items-center gap-2 self-start rounded-xl bg-destructive/10 px-2.5 py-1.5 text-[calc(12px*var(--zone-font-scale,1))] text-destructive">
              <span className="min-w-0 flex-1">
                {t("chat.clarify.errorPrefix")}: {state.error}
              </span>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors hover:bg-destructive/15"
              >
                <RefreshCw className="h-3 w-3" />
                {t("chat.clarify.retry")}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {canAnswer ? (
        <div className="flex shrink-0 items-end gap-1.5 border-t border-black/[0.05] px-2.5 py-1.5 dark:border-white/[0.08]">
          <textarea
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={t("chat.clarify.answerPlaceholder")}
            className="max-h-24 min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[calc(12px*var(--zone-font-scale,1))] leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
          <button
            type="button"
            onClick={onForceFinal}
            disabled={!canGenerate}
            title={t("chat.clarify.generate")}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-black/[0.06] px-2.5 text-[calc(11px*var(--zone-font-scale,1))] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:border-white/[0.12]"
          >
            <WandSparkles className="h-3 w-3" />
            <span className="whitespace-nowrap">{t("chat.clarify.generate")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
