// 工具路径不在授权目录内时，K-brain 暂停该调用；本卡片让用户就地授权被拒路径
// 所在的目录（或拒绝），答复后同一次工具调用继续执行。
// 纯展示组件，答复动作由宿主 adapter 注入（Gateway Web 不注入则不渲染）。

import { FolderTree, Loader2 } from "@liveagent/ui/components/IconSet";
import { useLocale } from "@liveagent/ui/i18n/index";
import { useState } from "react";
import type {
  ToolRootAccess,
  ToolRootDecision,
  ToolRootGrantScope,
  ToolRootRequest,
  ToolRootRequestAnswerer,
} from "../../lib/chat/toolRootRequest";
import { cn } from "../../lib/shared/utils";

const SCOPES: readonly ToolRootGrantScope[] = ["turn", "project", "repository", "global"];

const SCOPE_LABEL_KEYS: Record<ToolRootGrantScope, string> = {
  turn: "chat.rootGrantScopeTurn",
  project: "chat.rootGrantScopeProject",
  repository: "chat.rootGrantScopeRepository",
  global: "chat.rootGrantScopeGlobal",
};

type BusyAction = ToolRootGrantScope | "deny";

export function RootGrantCard({
  toolCallId,
  request,
  onAnswer,
}: {
  toolCallId: string;
  request: ToolRootRequest;
  onAnswer: ToolRootRequestAnswerer;
}) {
  const { t } = useLocale();
  const [access, setAccess] = useState<ToolRootAccess>(request.access);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [errorText, setErrorText] = useState("");

  // The card disappears once the store settles; it only shows errors itself.
  const answer = async (action: BusyAction) => {
    setBusy(action);
    setErrorText("");
    const decision: ToolRootDecision =
      action === "deny" ? { decision: "deny" } : { decision: "grant", scope: action, access };
    try {
      await onAnswer(toolCallId, decision);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-settings-tile px-3 py-2.5 text-xs">
      <div className="flex items-start gap-2">
        <FolderTree className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {t(
              request.code === "path_read_only_root"
                ? "chat.rootGrantReadOnlyTitle"
                : "chat.rootGrantOutsideTitle",
            )}
          </div>
          <div className="truncate font-mono text-muted-foreground" title={request.path}>
            {request.path}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <fieldset className="flex h-7 items-center gap-0.5 rounded-lg bg-settings-active p-0.5">
          <legend className="sr-only">{t("chat.workspaceSettingsDirectoryAccess")}</legend>
          {(["read", "write"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={access === option}
              disabled={busy !== null}
              onClick={() => setAccess(option)}
              className={cn(
                "rounded-md px-2 py-0.5 font-medium text-muted-foreground transition-colors",
                "hover:text-foreground disabled:opacity-50",
                access === option && "bg-background text-foreground shadow-sm",
              )}
            >
              {t(
                option === "read"
                  ? "chat.workspaceSettingsDirectoryRead"
                  : "chat.workspaceSettingsDirectoryWrite",
              )}
            </button>
          ))}
        </fieldset>
        {SCOPES.map((scope) => (
          <button
            key={scope}
            type="button"
            disabled={busy !== null}
            onClick={() => void answer(scope)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 font-medium",
              "transition-colors hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {busy === scope ? <Loader2 className="size-3 animate-spin" /> : null}
            {t(SCOPE_LABEL_KEYS[scope])}
          </button>
        ))}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void answer("deny")}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-lg px-2.5 font-medium text-muted-foreground",
            "transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {busy === "deny" ? <Loader2 className="size-3 animate-spin" /> : null}
          {t("chat.rootGrantDeny")}
        </button>
      </div>
      {errorText ? <div className="text-destructive">{errorText}</div> : null}
    </div>
  );
}
