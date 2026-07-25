import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_CHAT_TRANSCRIPT_WIDTH,
  MAX_CHAT_TRANSCRIPT_WIDTH,
  MIN_CHAT_TRANSCRIPT_WIDTH,
} from "../../../lib/settings";
import { cn } from "../../../lib/shared/utils";

export const CHAT_TRANSCRIPT_WIDTH_CSS_VAR = "--chat-transcript-content-width";

const TRANSCRIPT_HORIZONTAL_SAFE_SPACE = 64;

type TranscriptWidthControlsProps = {
  hostRef: RefObject<HTMLElement | null>;
  width: number;
  onWidthChange: (width: number) => void;
  resizeLabel: string;
  resetLabel: string;
};

type ResizeSide = "left" | "right";

function normalizePreferredWidth(width: number) {
  return Math.min(
    MAX_CHAT_TRANSCRIPT_WIDTH,
    Math.max(MIN_CHAT_TRANSCRIPT_WIDTH, Math.round(width)),
  );
}

function clampWidth(width: number, maxWidth: number) {
  return Math.min(maxWidth, normalizePreferredWidth(width));
}

function getMaxWidth(host: HTMLElement | null) {
  const hostWidth = host?.getBoundingClientRect().width ?? globalThis.innerWidth ?? 0;
  if (!Number.isFinite(hostWidth) || hostWidth <= 0) return MAX_CHAT_TRANSCRIPT_WIDTH;
  return Math.max(
    MIN_CHAT_TRANSCRIPT_WIDTH,
    Math.min(MAX_CHAT_TRANSCRIPT_WIDTH, Math.floor(hostWidth - TRANSCRIPT_HORIZONTAL_SAFE_SPACE)),
  );
}

function applyWidth(host: HTMLElement | null, width: number) {
  host?.style.setProperty(CHAT_TRANSCRIPT_WIDTH_CSS_VAR, `${Math.round(width)}px`);
}

export function TranscriptWidthControls(props: TranscriptWidthControlsProps) {
  const { hostRef, width, onWidthChange, resizeLabel, resetLabel } = props;
  const [maxWidth, setMaxWidth] = useState(MAX_CHAT_TRANSCRIPT_WIDTH);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const pendingWidthRef = useRef(width);
  const resizingRef = useRef(false);
  const resizeFrameRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const effectiveWidth = clampWidth(resizingWidth ?? width, maxWidth);

  useEffect(() => {
    if (resizingWidth !== null) return;
    applyWidth(hostRef.current, clampWidth(width, maxWidth));
  }, [hostRef, maxWidth, resizingWidth, width]);

  useEffect(() => {
    const host = hostRef.current;
    let frameId = 0;
    const updateMaxWidth = () => {
      frameId = 0;
      const nextMaxWidth = getMaxWidth(host);
      setMaxWidth(nextMaxWidth);
      if (!resizingRef.current) {
        applyWidth(host, clampWidth(width, nextMaxWidth));
      }
    };
    const scheduleUpdate = () => {
      if (frameId !== 0) return;
      frameId = requestAnimationFrame(updateMaxWidth);
    };
    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    if (host) observer?.observe(host);
    return () => {
      window.removeEventListener("resize", scheduleUpdate);
      if (frameId !== 0) cancelAnimationFrame(frameId);
      observer?.disconnect();
    };
  }, [hostRef, width]);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    },
    [],
  );

  const commitWidth = useCallback(
    (nextWidth: number) => {
      const preferredWidth = normalizePreferredWidth(nextWidth);
      const effectiveNextWidth = clampWidth(preferredWidth, getMaxWidth(hostRef.current));
      applyWidth(hostRef.current, effectiveNextWidth);
      pendingWidthRef.current = effectiveNextWidth;
      setResizingWidth(null);
      if (preferredWidth !== width) onWidthChange(preferredWidth);
    },
    [hostRef, onWidthChange, width],
  );

  const handleResizeStart = useCallback(
    (side: ResizeSide, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      event.preventDefault();
      event.stopPropagation();
      cleanupRef.current?.();

      const host = hostRef.current;
      const dragMaxWidth = getMaxWidth(host);
      const startX = event.clientX;
      const startWidth = clampWidth(width, dragMaxWidth);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      pendingWidthRef.current = startWidth;
      resizingRef.current = true;
      setMaxWidth(dragMaxWidth);
      setResizingWidth(startWidth);
      applyWidth(host, startWidth);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const scheduleWidth = (nextWidth: number) => {
        pendingWidthRef.current = clampWidth(nextWidth, dragMaxWidth);
        if (resizeFrameRef.current !== null) return;
        resizeFrameRef.current = requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          const pendingWidth = pendingWidthRef.current;
          applyWidth(hostRef.current, pendingWidth);
          setResizingWidth(pendingWidth);
        });
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
        window.removeEventListener("pointercancel", handleEnd);
        window.removeEventListener("blur", handleEnd);
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        resizingRef.current = false;
        cleanupRef.current = null;
      };

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        scheduleWidth(startWidth + (side === "right" ? delta * 2 : -delta * 2));
      };

      const handleEnd = () => {
        cleanup();
        commitWidth(pendingWidthRef.current);
      };

      cleanupRef.current = cleanup;
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd);
      window.addEventListener("pointercancel", handleEnd);
      window.addEventListener("blur", handleEnd);
    },
    [commitWidth, hostRef, width],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 64 : 16;
      let nextWidth: number | null = null;
      if (event.key === "ArrowLeft") nextWidth = width - step;
      if (event.key === "ArrowRight") nextWidth = width + step;
      if (event.key === "Home") nextWidth = DEFAULT_CHAT_TRANSCRIPT_WIDTH;
      if (nextWidth === null) return;
      event.preventDefault();
      commitWidth(nextWidth);
    },
    [commitWidth, width],
  );

  const resetWidth = useCallback(() => {
    commitWidth(DEFAULT_CHAT_TRANSCRIPT_WIDTH);
  }, [commitWidth]);

  if (maxWidth <= MIN_CHAT_TRANSCRIPT_WIDTH) return null;

  const renderHandle = (side: ResizeSide) => (
    <button
      type="button"
      role="separator"
      data-scroll-follow-ignore-keys
      aria-label={resizeLabel}
      aria-orientation="vertical"
      aria-valuemin={MIN_CHAT_TRANSCRIPT_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={effectiveWidth}
      title={side === "right" ? `${resizeLabel} · ${resetLabel}` : resetLabel}
      tabIndex={side === "right" ? 0 : -1}
      onPointerDown={(event) => handleResizeStart(side, event)}
      onDoubleClick={resetWidth}
      onKeyDown={side === "right" ? handleKeyDown : undefined}
      className={cn(
        "group pointer-events-auto absolute inset-y-0 z-10 w-3 touch-none cursor-col-resize border-0 bg-transparent p-0 focus-visible:outline-none",
        side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/25 opacity-0 shadow-sm transition-[height,background-color,opacity] duration-150",
          "group-hover:h-16 group-hover:bg-primary/60 group-hover:opacity-100 group-focus-visible:h-16 group-focus-visible:bg-primary group-focus-visible:opacity-100",
          resizingWidth !== null && "h-20 bg-primary opacity-100",
        )}
      />
    </button>
  );

  return (
    <div
      className="transcript-width-controls pointer-events-none absolute inset-y-0 left-1/2 z-[9] -translate-x-1/2"
      style={{
        width: `var(${CHAT_TRANSCRIPT_WIDTH_CSS_VAR}, ${DEFAULT_CHAT_TRANSCRIPT_WIDTH}px)`,
        maxWidth: `calc(100% - ${TRANSCRIPT_HORIZONTAL_SAFE_SPACE}px)`,
      }}
    >
      {renderHandle("left")}
      {renderHandle("right")}
      {resizingWidth !== null ? (
        <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-md border border-border/70 bg-background px-2 py-1 text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm">
          {effectiveWidth} px
        </div>
      ) : null}
    </div>
  );
}
