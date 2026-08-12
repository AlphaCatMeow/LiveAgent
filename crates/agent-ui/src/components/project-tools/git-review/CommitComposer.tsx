// GitReview commit composer: the card pinned to the bottom of the change
// list pane with the commit message editor, the AI generation action and the
// commit button. Shown in both the split and the stacked layout, so on
// narrow (mobile) widths committing never requires opening a file diff.
//
// Shared implementation owned by @liveagent/ui. Host-specific Git operations
// and optional platform capabilities enter through the shared contracts.

import { Loader2, WandSparkles } from "@liveagent/app/components/icons";
import { useLocale } from "@liveagent/ui/i18n/index";
import type { GitStatusEntry } from "@liveagent/ui/lib/git/types";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/shared/utils";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { useRightDockToolContext } from "../RightDockContext";
import {
  buildGitCommitMessagePrompt,
  buildGitCommitMessageSystemPrompt,
  parseGeneratedCommitMessage,
} from "./generateCommitMessage";
import type { GitReviewData } from "./useGitReviewData";

const MAX_COMMIT_MESSAGE_PATCH_CHARS = 64_000;

// Larger hit targets on touch devices without inflating the desktop dock.
const COARSE_POINTER_BUTTON_CLASS = "[@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9";

export function GitCommitComposer(props: {
  commitMessage: string;
  data: GitReviewData;
  onCommitMessageChange: (value: string) => void;
  stagedEntries: GitStatusEntry[];
  writeDisabled: boolean;
}) {
  const { commitMessage, data, onCommitMessageChange, stagedEntries, writeDisabled } = props;
  const { busy, cwd, gitClient, runOperation } = data;
  const context = useRightDockToolContext();
  const textGenerationClient = context.clients.textGeneration;
  const { locale, t } = useLocale();

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageValueRef = useRef(commitMessage);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRequestRef = useRef(0);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  // Previous message kept for the one-shot undo affordance after a generation
  // overwrote non-empty user input; programmatic value swaps do not land in
  // the browser undo stack, so Ctrl+Z cannot restore it.
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  useEffect(() => {
    messageValueRef.current = commitMessage;
  }, [commitMessage]);

  // Autosize: grow with content from one line up, clamped by max-height in
  // CSS (which also caps the composer on short mobile viewports). WebKit has
  // no `field-sizing: content` yet, so the measurement runs in JS.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the message value changes.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  }, [commitMessage]);

  const operationBusy = busy !== "";
  const generationConfigured = textGenerationClient?.status
    ? textGenerationClient.status() === "ready"
    : true;

  const stagedGenerationKey = useMemo(
    () =>
      JSON.stringify(
        stagedEntries.map((entry) => [entry.indexStatus, entry.oldPath ?? "", entry.path]),
      ),
    [stagedEntries],
  );

  const cancelGeneration = useCallback(() => {
    generationRequestRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setGenerating(false);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel in-flight generation when the repo or staged index changes.
  useEffect(() => {
    cancelGeneration();
    return cancelGeneration;
  }, [cancelGeneration, cwd, stagedGenerationKey]);

  const handleGenerate = useCallback(async () => {
    if (generating) {
      cancelGeneration();
      return;
    }
    if (
      !textGenerationClient ||
      !gitClient ||
      !generationConfigured ||
      writeDisabled ||
      operationBusy ||
      stagedEntries.length === 0
    ) {
      return;
    }

    const requestId = generationRequestRef.current + 1;
    generationRequestRef.current = requestId;
    const controller = new AbortController();
    generationAbortRef.current = controller;
    const messageBeforeGeneration = messageValueRef.current;
    setGenerating(true);
    setGenerationError("");

    try {
      const stagedDiff = await gitClient.diff(cwd, "staged");
      const patchWasTrimmed = stagedDiff.patch.length > MAX_COMMIT_MESSAGE_PATCH_CHARS;
      const response = await textGenerationClient.generate({
        systemPrompt: buildGitCommitMessageSystemPrompt(locale),
        userPrompt: buildGitCommitMessagePrompt({
          patch: stagedDiff.patch.slice(0, MAX_COMMIT_MESSAGE_PATCH_CHARS),
          files: stagedEntries,
          truncated: stagedDiff.truncated || patchWasTrimmed,
        }),
        output: "json",
        signal: controller.signal,
      });
      const generatedMessage = parseGeneratedCommitMessage(response, stagedEntries);
      if (
        controller.signal.aborted ||
        generationRequestRef.current !== requestId ||
        messageValueRef.current !== messageBeforeGeneration
      ) {
        return;
      }
      setUndoMessage(messageBeforeGeneration.trim() ? messageBeforeGeneration : null);
      onCommitMessageChange(generatedMessage);
      textareaRef.current?.focus();
    } catch (err) {
      if (controller.signal.aborted || generationRequestRef.current !== requestId) return;
      setGenerationError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generationRequestRef.current === requestId) {
        generationAbortRef.current = null;
        setGenerating(false);
      }
    }
  }, [
    cancelGeneration,
    cwd,
    generating,
    generationConfigured,
    gitClient,
    locale,
    onCommitMessageChange,
    operationBusy,
    stagedEntries,
    textGenerationClient,
    writeDisabled,
  ]);

  const canCommit =
    !writeDisabled && !operationBusy && !generating && commitMessage.trim().length > 0;

  const handleCommit = useCallback(() => {
    if (!canCommit || !gitClient) return;
    void runOperation("commit", () => gitClient.commit(cwd, commitMessage), "commit").then((ok) => {
      if (ok) {
        onCommitMessageChange("");
        setUndoMessage(null);
      }
    });
  }, [canCommit, commitMessage, cwd, gitClient, onCommitMessageChange, runOperation]);

  const handleMessageChange = useCallback(
    (value: string) => {
      setUndoMessage(null);
      setGenerationError("");
      onCommitMessageChange(value);
    },
    [onCommitMessageChange],
  );

  const handleUndoGeneration = useCallback(() => {
    if (undoMessage === null) return;
    onCommitMessageChange(undoMessage);
    setUndoMessage(null);
    textareaRef.current?.focus();
  }, [onCommitMessageChange, undoMessage]);

  const handleTextareaKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape" && generating) {
        event.preventDefault();
        cancelGeneration();
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleCommit();
      }
    },
    [cancelGeneration, generating, handleCommit],
  );

  const generateDisabled =
    !generating &&
    (writeDisabled || operationBusy || stagedEntries.length === 0 || !generationConfigured);
  const generateLabel = generating
    ? t("projectTools.gitReview.generateCommitMessageCancel")
    : stagedEntries.length === 0
      ? t("projectTools.gitReview.generateCommitMessageRequiresStaged")
      : !generationConfigured
        ? t("projectTools.gitReview.generateCommitMessageRequiresModel")
        : t("projectTools.gitReview.generateCommitMessage");

  return (
    <div className="shrink-0 border-t border-border/60 p-2">
      <div className="rounded-lg border border-border/70 bg-background focus-within:ring-1 focus-within:ring-border/40">
        <Textarea
          ref={textareaRef}
          rows={1}
          value={commitMessage}
          onChange={(event) => handleMessageChange(event.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder={t("projectTools.gitReview.commitMessagePlaceholder")}
          disabled={writeDisabled || operationBusy}
          className="max-h-[min(10rem,30dvh)] min-h-8 resize-none overflow-y-auto border-0 bg-transparent px-2.5 py-1.5 text-[calc(11px*var(--zone-font-scale,1))] leading-4 shadow-none placeholder:text-[calc(11px*var(--zone-font-scale,1))]"
        />
        <div className="flex items-center gap-2 border-t border-border/60 px-1.5 py-1">
          {textGenerationClient ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={generateDisabled}
              className={cn("h-7 w-7 shrink-0 px-0", COARSE_POINTER_BUTTON_CLASS)}
              title={generateLabel}
              aria-label={generateLabel}
              onClick={() => void handleGenerate()}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <WandSparkles className="h-3.5 w-3.5 text-primary" />
              )}
            </Button>
          ) : null}
          <div className="min-w-0 flex-1 text-[calc(11px*var(--zone-font-scale,1))] leading-4">
            {generationError ? (
              <p className="truncate text-destructive" title={generationError}>
                {generationError}
              </p>
            ) : generating ? (
              <p className="truncate text-muted-foreground">
                {t("projectTools.gitReview.generateCommitMessageGenerating")}
              </p>
            ) : undoMessage !== null ? (
              <button
                type="button"
                className="truncate rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={handleUndoGeneration}
              >
                {t("projectTools.gitReview.generateCommitMessageUndo")}
              </button>
            ) : null}
          </div>
          <Button
            size="sm"
            disabled={!canCommit}
            className="h-7 shrink-0 [@media(pointer:coarse)]:h-9"
            onClick={handleCommit}
          >
            {busy === "commit" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              t("projectTools.gitReview.commit")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
