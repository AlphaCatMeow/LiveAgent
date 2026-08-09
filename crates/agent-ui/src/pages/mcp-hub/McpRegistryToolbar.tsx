import { Loader2, RefreshCw, Search } from "@liveagent/app/components/icons";
import { Button } from "@liveagent/ui/components/ui/button";
import { Input } from "@liveagent/ui/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@liveagent/ui/components/ui/toggle-group";
import { useLocale } from "@liveagent/ui/i18n/index";
import {
  MCP_REGISTRY_SOURCE_OPTIONS,
  type McpRegistrySource,
} from "@liveagent/ui/lib/mcpRegistry/index";
import { cn } from "@liveagent/ui/lib/shared/utils";

export function McpRegistryToolbar(props: {
  query: string;
  source: McpRegistrySource;
  loading: boolean;
  loadingMore: boolean;
  onQueryChange: (query: string) => void;
  onSourceChange: (source: McpRegistrySource) => void;
  onSearch: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="hub-panel-enter flex flex-col gap-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSearch();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.currentTarget.value)}
            placeholder={t("mcpHub.storeSearchPlaceholder")}
            className="h-10 rounded-xl border-border/70 bg-card pl-9 text-[13px] shadow-xs placeholder:text-muted-foreground"
          />
        </div>
        <Button
          size="sm"
          type="submit"
          className="h-10 w-10 shrink-0 rounded-xl px-0 sm:w-auto sm:gap-1.5 sm:px-4"
          disabled={props.loading}
          title={t("mcpHub.storeSearch")}
          aria-label={t("mcpHub.storeSearch")}
        >
          {props.loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">{t("mcpHub.storeSearch")}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          className="h-10 w-10 shrink-0 rounded-xl border-border/70 bg-card px-0 shadow-xs sm:w-auto sm:gap-1.5 sm:px-4"
          disabled={props.loading || props.loadingMore}
          onClick={props.onSearch}
          title={t("mcpHub.storeRefresh")}
          aria-label={t("mcpHub.storeRefresh")}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", props.loading && "animate-spin")} />
          <span className="hidden sm:inline">{t("mcpHub.storeRefresh")}</span>
        </Button>
      </form>

      <ToggleGroup
        value={[props.source]}
        onValueChange={(values) => {
          const nextSource = values[0] as McpRegistrySource | undefined;
          if (nextSource) props.onSourceChange(nextSource);
        }}
        aria-label={t("mcpHub.tabStore")}
        className="max-w-full self-start gap-1 overflow-x-auto rounded-xl border border-border/70 bg-muted/50 p-1 shadow-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {MCP_REGISTRY_SOURCE_OPTIONS.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            className="h-8 shrink-0 rounded-lg border border-transparent px-3 text-[11.5px] text-foreground/70 hover:bg-background/70 hover:text-foreground data-[pressed]:border-border/70 data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-xs"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
