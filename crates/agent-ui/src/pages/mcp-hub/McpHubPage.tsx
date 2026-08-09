import {
  Cable,
  Cloud,
  Download,
  Plug,
  Plus,
  Server,
  Sparkles,
} from "@liveagent/app/components/icons";
import { type AppSettings, type McpServerConfig, updateMcp } from "@liveagent/app/lib/settings";
import { useLocale } from "@liveagent/ui/i18n/index";
import { McpRegistryBrowser } from "@liveagent/ui/pages/mcp-hub/McpRegistryBrowser";
import { McpServerEditModal, McpServersForm } from "@liveagent/ui/pages/mcp-hub/McpServersForm";
import { useState } from "react";
import { HubBackdrop, HubHeader } from "../../components/hub/HubChrome";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { cn } from "../../lib/shared/utils";
import { McpImportView } from "./McpImportView";

type McpHubPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  isAgentMode: boolean;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
};

type McpHubView = "installed" | "store" | "import";

type EditingState = { mode: "add" } | { mode: "edit"; idx: number; server: McpServerConfig };

function isMcpHubView(value: unknown): value is McpHubView {
  return value === "installed" || value === "store" || value === "import";
}

export function McpHubPage(props: McpHubPageProps) {
  const { settings, setSettings, sidebarOpen, onOpenSidebar } = props;
  const { t } = useLocale();
  const [view, setView] = useState<McpHubView>("installed");
  const [editing, setEditing] = useState<EditingState | null>(null);

  const serverCount = settings.mcp.servers.length;
  const enabledCount = settings.mcp.servers.filter((server) => server.enabled).length;
  const ready = serverCount > 0;
  const statusHint = ready ? null : t("mcpHub.statusEmptyDesc");

  function openAdd() {
    setView("installed");
    setEditing({ mode: "add" });
  }

  function openEdit(server: McpServerConfig, idx: number) {
    setEditing({ mode: "edit", idx, server });
  }

  function handleModalSave(server: McpServerConfig) {
    setSettings((prev) => {
      if (editing?.mode === "edit") {
        const targetIdx = editing.idx;
        return updateMcp(prev, {
          servers: prev.mcp.servers.map((item, index) => (index === targetIdx ? server : item)),
        });
      }
      return updateMcp(prev, {
        servers: [...prev.mcp.servers, server],
      });
    });
  }

  return (
    <div className="hub-page hub-page-enter relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <HubBackdrop tone="violet" />

      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <HubHeader
          icon={<Cable className="h-5 w-5" />}
          title="MCP Hub"
          subtitle={t("mcpHub.subtitle")}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={onOpenSidebar}
        />

        <div className="hub-scroll min-h-0 flex-1 overflow-hidden px-5 pb-6 pt-2 sm:px-6 lg:px-8 xl:px-10">
          <div className="hub-content-stage mx-auto flex h-full min-h-0 w-full max-w-[1320px] flex-col gap-4">
            {/* Status banner */}
            <div
              className={cn(
                "hub-panel-enter relative overflow-hidden rounded-2xl border bg-card shadow-xs",
                ready ? "border-emerald-500/30" : "border-border/70",
              )}
            >
              <div className="flex items-center gap-3 px-4 py-3.5 sm:gap-x-5 sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-3.5">
                  <div
                    className={cn(
                      "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors",
                      ready
                        ? "border-border/70 bg-background text-foreground shadow-xs"
                        : "border-border/70 bg-muted text-muted-foreground",
                    )}
                  >
                    <Plug className="h-5 w-5" />
                    {ready && enabledCount > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="text-[13.5px] font-semibold tracking-tight text-foreground">
                        {ready ? t("mcpHub.statusReady") : t("mcpHub.statusEmpty")}
                      </div>
                      {ready ? (
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums",
                            enabledCount > 0
                              ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground ring-1 ring-border/60",
                          )}
                        >
                          <span className="font-semibold">{enabledCount}</span>
                          <span className="opacity-50">/</span>
                          <span className="opacity-80">{serverCount}</span>
                          <span className="ml-0.5 opacity-70">{t("mcpHub.enabled")}</span>
                        </span>
                      ) : null}
                    </div>
                    {statusHint ? (
                      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        {statusHint}
                      </div>
                    ) : null}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 rounded-lg border-border/70 bg-background px-3 shadow-xs sm:px-3.5"
                  onClick={openAdd}
                  title={t("mcpHub.add")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden whitespace-nowrap sm:inline">{t("mcpHub.add")}</span>
                </Button>
              </div>
            </div>

            <Tabs
              value={view}
              onValueChange={(nextView) => {
                if (isMcpHubView(nextView)) setView(nextView);
              }}
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <div className="hub-panel-enter flex items-center justify-between gap-3">
                <TabsList className="h-10 shrink-0 rounded-xl border border-border/70 bg-muted/50 p-1 text-muted-foreground shadow-xs">
                  {[
                    {
                      value: "installed" as const,
                      label: t("mcpHub.tabInstalled"),
                      icon: Server,
                      count: serverCount,
                    },
                    {
                      value: "store" as const,
                      label: t("mcpHub.tabStore"),
                      icon: Cloud,
                      count: null,
                    },
                    {
                      value: "import" as const,
                      label: t("mcpHub.tabImport"),
                      icon: Download,
                      count: null,
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    const active = view === item.value;
                    return (
                      <TabsTrigger
                        key={item.value}
                        value={item.value}
                        className={cn(
                          "relative h-8 gap-1.5 rounded-lg px-3 text-[12.5px] data-[active]:ring-1 data-[active]:ring-border/60",
                          !active && "hover:bg-background/70 hover:text-foreground",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{item.label}</span>
                        {item.count !== null && item.count > 0 ? (
                          <span
                            className={cn(
                              "ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                              active
                                ? "bg-foreground/[0.08] text-foreground/85"
                                : "bg-muted/70 text-muted-foreground",
                            )}
                          >
                            {item.count}
                          </span>
                        ) : null}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {view === "store" ? (
                  <div className="hidden text-[11.5px] text-muted-foreground sm:flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-foreground/55" />
                    <span>{t("mcpHub.storeSubtitle")}</span>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <TabsContent value="installed" className="h-full min-h-0">
                  <McpServersForm
                    settings={settings}
                    setSettings={setSettings}
                    onAddServer={openAdd}
                    onEditServer={openEdit}
                  />
                </TabsContent>
                <TabsContent value="store" className="h-full min-h-0">
                  <McpRegistryBrowser settings={settings} setSettings={setSettings} />
                </TabsContent>
                <TabsContent value="import" className="h-full min-h-0">
                  <McpImportView settings={settings} setSettings={setSettings} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>

      {editing ? (
        <McpServerEditModal
          mode={editing.mode}
          initialServer={editing.mode === "edit" ? editing.server : null}
          existingServers={settings.mcp.servers}
          onClose={() => setEditing(null)}
          onSave={handleModalSave}
        />
      ) : null}
    </div>
  );
}
