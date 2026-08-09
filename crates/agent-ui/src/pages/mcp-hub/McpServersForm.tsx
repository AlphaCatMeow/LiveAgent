import { Plug, Plus, Search, Server } from "@liveagent/app/components/icons";
import {
  type AppSettings,
  type McpServerConfig,
  updateSystem,
} from "@liveagent/app/lib/settings/index";
import { Button } from "@liveagent/ui/components/ui/button";
import { Input } from "@liveagent/ui/components/ui/input";
import { useLocale } from "@liveagent/ui/i18n/index";
import { useMemo, useState } from "react";
import { McpServerCard } from "./McpServerCard";

export { McpServerEditModal } from "./McpServerEditModal";

const SERVER_POLICY_PREFIX = "server:";

function serverPolicyKey(serverId: string): string {
  return `${SERVER_POLICY_PREFIX}${serverId}`;
}

type SetMcpSettingsFn = (updater: (prev: AppSettings) => AppSettings) => void;

type McpServersFormProps = {
  settings: AppSettings;
  setSettings: SetMcpSettingsFn;
  onAddServer?: () => void;
  onEditServer?: (server: McpServerConfig, idx: number) => void;
};

export function McpServersForm(props: McpServersFormProps) {
  const { settings, setSettings, onAddServer, onEditServer } = props;
  const { t } = useLocale();
  const [filter, setFilter] = useState("");
  const servers = settings.mcp.servers;
  const serverCount = servers.length;

  const filtered = useMemo(() => {
    const text = filter.trim().toLowerCase();
    if (!text) return servers.map((server, idx) => ({ server, idx }));
    return servers
      .map((server, idx) => ({ server, idx }))
      .filter(({ server }) =>
        [
          server.id,
          server.description,
          server.docsUrl,
          server.command,
          server.url,
          server.transport ?? "",
        ]
          .join("\n")
          .toLowerCase()
          .includes(text),
      );
  }, [filter, servers]);

  return (
    <div className="h-full min-h-0 overflow-y-auto px-1 pb-4 pt-2">
      <div className="flex flex-col gap-4">
        {serverCount > 4 ? (
          <div className="hub-panel-enter relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
              placeholder={t("mcpHub.searchInstalled")}
              className="h-10 rounded-xl border-border/70 bg-card pl-9 text-[13px] shadow-xs placeholder:text-muted-foreground"
            />
          </div>
        ) : null}

        {serverCount === 0 ? (
          <div className="hub-panel-enter rounded-2xl border border-dashed border-border/70 bg-card px-6 py-12 text-center shadow-xs">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background text-foreground shadow-xs">
              <Server className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">{t("mcpHub.noServers")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("mcpHub.noServersHint")}</p>
            {onAddServer ? (
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={onAddServer}>
                <Plus className="h-3.5 w-3.5" />
                {t("mcpHub.add")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {filter.trim() && filtered.length === 0 && serverCount > 0 ? (
          <div className="hub-panel-enter rounded-2xl border border-border/70 bg-card px-6 py-8 text-center shadow-xs">
            <Plug className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">{t("mcpHub.noMatchInstalled")}</p>
          </div>
        ) : null}

        {filtered.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {filtered.map(({ server, idx }) => (
              <McpServerCard
                key={`${server.id}:${idx}`}
                server={server}
                idx={idx}
                setSettings={setSettings}
                onEdit={() => onEditServer?.(server, idx)}
                policy={settings.system.toolPolicies?.[serverPolicyKey(server.id)] ?? "allow"}
                onPolicyChange={(next) =>
                  setSettings((prev) => {
                    const current = { ...(prev.system.toolPolicies ?? {}) };
                    const key = serverPolicyKey(server.id);
                    if (next === "allow") delete current[key];
                    else current[key] = next;
                    return updateSystem(prev, {
                      toolPolicies: Object.keys(current).length > 0 ? current : undefined,
                    });
                  })
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
