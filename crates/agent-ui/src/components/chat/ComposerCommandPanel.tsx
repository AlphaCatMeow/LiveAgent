import { X } from "@liveagent/ui/components/IconSet";
import { useLocale } from "@liveagent/ui/i18n/index";
import {
  type ComposerCommandPanelState,
  describeLoopInterval,
} from "@liveagent/ui/lib/chat/composerCommands";
import { cn } from "@liveagent/ui/lib/shared/utils";

/**
 * “/”指令的本地结果面板（/loop 列表、执行提示、错误）：渲染在输入框内、
 * 正文上方，可关闭，不进入转录区，也不发给模型。
 */
export function ComposerCommandPanel({
  panel,
  onClose,
}: {
  panel: ComposerCommandPanelState;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const title =
    panel.type === "loops"
      ? t("chat.commands.loopsTitle")
      : panel.type === "loopCreated"
        ? t("chat.commands.loopCreated")
        : panel.type === "notice"
          ? t("chat.commands.title")
          : t("chat.commands.failed");

  return (
    <section
      role="status"
      aria-label={title}
      data-composer-command-panel={panel.type}
      className="mb-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">{title}</span>
        <button
          type="button"
          aria-label={t("chat.commands.closePanel")}
          title={t("chat.commands.closePanel")}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      </div>
      {panel.type === "loopCreated" ? (
        <div className="flex flex-col gap-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
            <dt>{t("chat.commands.loopInterval")}</dt>
            <dd className="min-w-0 text-foreground/90">
              {describeLoopInterval(panel.loop.interval, t)}
            </dd>
            <dt>{t("chat.commands.loopPrompt")}</dt>
            <dd className="min-w-0 truncate text-foreground/90" title={panel.loop.prompt}>
              {panel.loop.prompt}
            </dd>
          </dl>
          <p className="text-muted-foreground/80">
            {t("chat.commands.loopHint")}{" "}
            <code className="font-mono text-foreground/80">/loop cancel {panel.loop.id}</code>
          </p>
        </div>
      ) : panel.type === "loops" ? (
        panel.loops.length === 0 ? (
          <p className="text-muted-foreground">{t("chat.commands.loopsEmpty")}</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {panel.loops.map((loop) => (
              <li key={loop.id} className="flex min-w-0 gap-2">
                <span className="shrink-0 font-mono text-foreground/90">{loop.id}</span>
                <span className="shrink-0 tabular-nums text-foreground/90">
                  {describeLoopInterval(loop.interval, t)}
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate text-muted-foreground",
                    !loop.enabled && "line-through",
                  )}
                  title={loop.prompt}
                >
                  {loop.prompt}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className={panel.type === "error" ? "text-destructive" : "text-foreground/90"}>
          {panel.message}
        </p>
      )}
    </section>
  );
}
