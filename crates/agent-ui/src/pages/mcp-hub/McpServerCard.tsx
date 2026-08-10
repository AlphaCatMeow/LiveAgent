import {
  ExternalLink,
  Globe2,
  Pencil,
  Terminal,
  Trash2,
  Wifi,
} from "@liveagent/app/components/icons";
import {
  type AppSettings,
  type McpServerConfig,
  removeWorkspaceResourceReferences,
  type ToolPolicy,
  updateMcp,
} from "@liveagent/app/lib/settings/index";
import { ToolPolicyToggle } from "@liveagent/ui/components/hub/ToolPolicyToggle";
import { ResourceActivationSwitch } from "@liveagent/ui/components/resources/ResourceActivationSwitch";
import { ConfirmDeletePopover } from "@liveagent/ui/components/ui/confirm-action-popover";
import { useLocale } from "@liveagent/ui/i18n/index";
import { resolveMcpDocsHref } from "@liveagent/ui/lib/mcpServerMetadata";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { memo } from "react";

type SetMcpSettingsFn = (updater: (prev: AppSettings) => AppSettings) => void;

function transportMeta(transport: string) {
  if (transport === "http") return { label: "http", Icon: Globe2 } as const;
  if (transport === "sse") return { label: "sse", Icon: Wifi } as const;
  return { label: "stdio", Icon: Terminal } as const;
}

function CounterPill(props: { label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border/60">
      <span className="font-semibold tabular-nums text-foreground">{props.count}</span>
      <span>{props.label}</span>
    </span>
  );
}

export const McpServerCard = memo(function McpServerCard(props: {
  server: McpServerConfig;
  idx: number;
  setSettings: SetMcpSettingsFn;
  onEdit: () => void;
  policy: ToolPolicy;
  onPolicyChange: (next: ToolPolicy) => void;
}) {
  const { server, idx, setSettings, onEdit, policy, onPolicyChange } = props;
  const { t } = useLocale();
  const transport = server.transport || "stdio";
  const isStdio = transport === "stdio";
  const isHttp = transport === "http";
  const { Icon: TransportIcon, label: transportLabel } = transportMeta(transport);
  const enabled = server.enabled;

  const patchServer = (patch: Partial<McpServerConfig>) => {
    setSettings((prev) =>
      updateMcp(prev, {
        servers: prev.mcp.servers.map((item, index) =>
          index === idx ? { ...item, ...patch } : item,
        ),
      }),
    );
  };

  const argsCount = (server.args ?? []).filter(Boolean).length;
  const envCount = server.env ? Object.keys(server.env).length : 0;
  const headerCount = server.headers ? Object.keys(server.headers).length : 0;
  const previewLine = isStdio
    ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
    : server.url || "";
  const previewLabel = isStdio
    ? t("mcpHub.command")
    : isHttp
      ? t("mcpHub.urlHttp")
      : t("mcpHub.urlSse");
  const docsLink = resolveMcpDocsHref(server.docsUrl);

  return (
    <article
      className={cn(
        "skill-card-enter group rounded-2xl border bg-card shadow-xs transition-colors",
        enabled
          ? "border-emerald-500/35 hover:border-emerald-500/50"
          : "border-border/70 hover:border-border",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <ResourceActivationSwitch
          checked={enabled}
          compact
          label={`${server.id || `Server ${idx + 1}`}: ${enabled ? t("settings.disable") : t("settings.enable")}`}
          onCheckedChange={(checked) => patchServer({ enabled: checked })}
        />

        <button
          type="button"
          onClick={onEdit}
          title={t("settings.edit")}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background text-foreground shadow-xs">
            <TransportIcon className="h-[18px] w-[18px]" />
          </span>

          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-semibold leading-tight text-foreground">
                {server.id || `Server ${idx + 1}`}
              </span>
              <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/75 ring-1 ring-border/60">
                {transportLabel}
              </span>
              {enabled ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                  {t("mcpHub.enabled")}
                </span>
              ) : null}
            </span>
            {server.description ? (
              <span className="truncate text-[11px] text-foreground/75" title={server.description}>
                {server.description}
              </span>
            ) : null}
            {previewLine ? (
              <span className="truncate text-[11px] text-muted-foreground" title={previewLine}>
                <span>{previewLabel}:</span> <span className="font-mono">{previewLine}</span>
              </span>
            ) : (
              <span className="truncate text-[11px] italic text-muted-foreground">
                {isStdio ? "未配置启动命令" : "未配置 URL"}
              </span>
            )}
          </span>
        </button>

        {argsCount > 0 || envCount > 0 || headerCount > 0 ? (
          <div className="hidden shrink-0 items-center gap-1 md:flex">
            {argsCount > 0 ? (
              <CounterPill label={t("mcpHub.previewArgs")} count={argsCount} />
            ) : null}
            {envCount > 0 ? <CounterPill label={t("mcpHub.previewEnv")} count={envCount} /> : null}
            {headerCount > 0 ? (
              <CounterPill label={t("mcpHub.previewHeaders")} count={headerCount} />
            ) : null}
          </div>
        ) : null}

        <div className="flex shrink-0 items-center gap-1.5">
          <ToolPolicyToggle
            value={policy}
            ariaLabel={server.id || `Server ${idx + 1}`}
            onChange={onPolicyChange}
            size="sm"
          />
          {docsLink ? (
            <a
              href={docsLink}
              target="_blank"
              rel="noreferrer"
              title={server.docsUrl}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            title={t("settings.edit")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <ConfirmDeletePopover
            name={server.id || `Server ${idx + 1}`}
            onConfirm={() =>
              setSettings((prev) =>
                removeWorkspaceResourceReferences(
                  updateMcp(prev, {
                    servers: prev.mcp.servers.filter((_, index) => index !== idx),
                  }),
                  { mcpServerIds: [server.id] },
                ),
              )
            }
          >
            {(open) => (
              <button
                type="button"
                onClick={open}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={t("settings.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </ConfirmDeletePopover>
        </div>
      </div>
    </article>
  );
});
