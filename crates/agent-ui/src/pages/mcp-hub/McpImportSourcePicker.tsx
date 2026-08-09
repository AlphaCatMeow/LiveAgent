import { FileText, Folder } from "@liveagent/app/components/icons";
import { ToggleGroup, ToggleGroupItem } from "@liveagent/ui/components/ui/toggle-group";
import { useLocale } from "@liveagent/ui/i18n/index";
import type { ExternalMcpToolScan } from "@liveagent/ui/lib/skills/index";

const EXTERNAL_MCP_TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "claude-desktop": "Claude Desktop",
  codebuddy: "CodeBuddy",
};

export const LOCAL_FILE_TOOL = "local-file";

function fileScanLabel(scan: ExternalMcpToolScan, fallback: string) {
  const basename = scan.configPath.split(/[\\/]/).pop();
  return basename || fallback;
}

export function McpImportSourcePicker(props: {
  scans: ExternalMcpToolScan[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();

  return (
    <ToggleGroup
      value={[props.value]}
      onValueChange={(values) => {
        const nextValue = values[0];
        if (nextValue) props.onChange(nextValue);
      }}
      aria-label={t("mcpHub.tabImport")}
      className="max-w-full shrink-0 gap-1 overflow-x-auto rounded-xl border border-border/70 bg-muted/50 p-1 shadow-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {props.scans.map((scan) => {
        const isLocalFile = scan.tool === LOCAL_FILE_TOOL;
        const toolLabel = isLocalFile
          ? fileScanLabel(scan, t("mcpHub.importFileTab"))
          : (EXTERNAL_MCP_TOOL_LABELS[scan.tool] ?? scan.tool);
        return (
          <ToggleGroupItem
            key={scan.tool}
            value={scan.tool}
            title={isLocalFile ? scan.configPath : undefined}
            className="group h-8 shrink-0 gap-1.5 rounded-lg border border-transparent px-3 text-[12px] text-foreground/70 hover:bg-background/70 hover:text-foreground data-[pressed]:border-border/70 data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-xs"
          >
            {isLocalFile ? (
              <FileText className="h-3.5 w-3.5" />
            ) : (
              <Folder className="h-3.5 w-3.5" />
            )}
            <span className="max-w-[10rem] truncate">{toolLabel}</span>
            <span className="ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-background px-1 text-[10px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border/50 group-data-[pressed]:text-foreground">
              {scan.exists ? scan.servers.length : "—"}
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
