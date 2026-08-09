import {
  AlertTriangle,
  Check,
  Download,
  Folder,
  ListChecks,
  Loader2,
  RefreshCw,
  X,
} from "@liveagent/app/components/icons";
import { GlassPanel } from "@liveagent/ui/components/hub/HubChrome";
import { Button } from "@liveagent/ui/components/ui/button";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import type { ExternalSkillEntry, ExternalToolScan } from "@liveagent/ui/lib/skills/index";
import { truncateLocalSkillCardDescription } from "@liveagent/ui/lib/skills/skillCardMetadata";
import { useEffect, useMemo, useRef, useState } from "react";

const EXTERNAL_TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  codebuddy: "CodeBuddy",
  agents: "Agent Skills",
};

export function SkillsImportView(props: {
  scans: ExternalToolScan[];
  loading: boolean;
  error: string | null;
  query: string;
  selected: ReadonlySet<string>;
  installedNames: ReadonlySet<string>;
  importProgress: { done: number; total: number } | null;
  importingExternalBaseDir: string | null;
  importErrors: Array<{ baseDir: string; name: string; message: string }>;
  importedCount: number | null;
  importToast: string | null;
  onDismissImportToast: () => void;
  bulkMode: boolean;
  onToggle: (baseDir: string) => void;
  onBatchToggle: (baseDirs: string[], on: boolean) => void;
  onRescan: () => void;
  onImport: (skill?: ExternalSkillEntry) => void;
}) {
  const {
    scans,
    loading,
    error,
    query,
    selected,
    installedNames,
    importProgress,
    importingExternalBaseDir,
    importErrors,
    importedCount,
    importToast,
    onDismissImportToast,
    bulkMode,
    onToggle,
    onBatchToggle,
    onRescan,
    onImport,
  } = props;
  const { t } = useLocale();
  const bulkAnchorRef = useRef<string | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredScans = useMemo(
    () =>
      scans.map((scan) => ({
        ...scan,
        skills: normalizedQuery
          ? scan.skills.filter(
              (skill) =>
                skill.name.toLowerCase().includes(normalizedQuery) ||
                skill.description.toLowerCase().includes(normalizedQuery),
            )
          : scan.skills,
      })),
    [scans, normalizedQuery],
  );
  const importing = importProgress !== null;
  const importableSelectedCount = useMemo(() => {
    let count = 0;
    for (const scan of scans) {
      for (const skill of scan.skills) {
        if (installedNames.has(skill.name)) continue;
        if (selected.has(skill.baseDir)) count += 1;
      }
    }
    return count;
  }, [scans, installedNames, selected]);

  const [activeTool, setActiveTool] = useState<string>(scans[0]?.tool ?? "claude-code");
  const userChoseToolRef = useRef(false);
  // 扫描结果就绪后自动定位到第一个有技能的工具；用户手动切换后不再干预
  useEffect(() => {
    if (userChoseToolRef.current || scans.length === 0) return;
    const preferred =
      scans.find((scan) => scan.skills.length > 0) ?? scans.find((scan) => scan.exists) ?? scans[0];
    if (preferred && preferred.tool !== activeTool) {
      setActiveTool(preferred.tool);
    }
  }, [scans, activeTool]);
  const activeScan = filteredScans.find((scan) => scan.tool === activeTool);
  // 「已选 X / Y」与全选按钮都只统计可导入项：已安装项不可选，不计入分子分母。
  const selectableVisibleBaseDirs = useMemo(
    () =>
      activeScan?.skills
        .filter((skill) => !installedNames.has(skill.name))
        .map((skill) => skill.baseDir) ?? [],
    [activeScan, installedNames],
  );
  const selectedSelectableVisibleCount = useMemo(
    () =>
      selectableVisibleBaseDirs.reduce(
        (count, baseDir) => count + (selected.has(baseDir) ? 1 : 0),
        0,
      ),
    [selectableVisibleBaseDirs, selected],
  );
  const allVisibleSelected =
    selectableVisibleBaseDirs.length > 0 &&
    selectedSelectableVisibleCount === selectableVisibleBaseDirs.length;

  return (
    <div
      className={cn(
        "relative h-full min-h-0 overflow-y-auto px-0.5 pr-1 pt-1.5",
        bulkMode ? "pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-24" : "pb-4",
      )}
    >
      {importToast ? (
        <div className="pointer-events-none sticky top-2 z-[80] flex justify-end px-1">
          <div className="notify-toast-enter pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2.5 text-sm shadow-lg dark:border-amber-500/25 dark:bg-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="min-w-0 flex-1 leading-relaxed text-amber-800 dark:text-amber-200">
              {importToast}
            </p>
            <button
              type="button"
              onClick={onDismissImportToast}
              className="mt-0.5 shrink-0 rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
              aria-label={t("settings.cancel")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-4">
        {error ? (
          <GlassPanel tone="error" className="hub-panel-enter">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <span className="text-xs text-destructive">
                {t("settings.skillsImportScanFailed")}: {error}
              </span>
            </div>
          </GlassPanel>
        ) : null}

        {importErrors.length > 0 ? (
          <GlassPanel tone="error" className="hub-panel-enter">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="text-xs font-medium text-destructive">
                  {t("settings.skillsImportFailed")}
                </span>
              </div>
              {importErrors.map((failure) => (
                <div key={failure.baseDir} className="pl-6 text-[11px] text-destructive/90">
                  {failure.name}: {failure.message}
                </div>
              ))}
            </div>
          </GlassPanel>
        ) : null}

        {importedCount !== null && importedCount > 0 ? (
          <GlassPanel tone="muted" className="hub-panel-enter">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-[hsl(var(--chat-success))]" />
              <span className="text-xs text-muted-foreground">
                {t("settings.skillsImportDone")} ({importedCount})
              </span>
            </div>
          </GlassPanel>
        ) : null}

        {loading ? (
          <GlassPanel className="hub-panel-enter">
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {t("settings.skillsImportScanning")}
              </span>
            </div>
          </GlassPanel>
        ) : (
          <>
            <div className="hub-panel-enter sticky top-0 z-30 -mx-0.5 flex flex-wrap items-center justify-between gap-3 bg-background/95 px-0.5 pb-2 pt-1.5 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.45)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 dark:shadow-[0_14px_24px_-22px_rgba(0,0,0,0.8)]">
              <div className="inline-flex shrink-0 rounded-2xl border border-border/40 bg-background/60 p-1 backdrop-blur-xl shadow-[0_1px_0_rgba(255,255,255,0.5)_inset] dark:border-white/[0.06] dark:bg-white/[0.04] dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
                {filteredScans.map((scan) => {
                  const toolLabel = EXTERNAL_TOOL_LABELS[scan.tool] ?? scan.tool;
                  const active = scan.tool === activeTool;
                  return (
                    <button
                      key={scan.tool}
                      type="button"
                      onClick={() => {
                        userChoseToolRef.current = true;
                        setActiveTool(scan.tool);
                      }}
                      className={cn(
                        "relative inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-[12.5px] font-medium transition-all",
                        active
                          ? "bg-background/85 text-foreground shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_4px_12px_-8px_rgba(15,23,42,0.18)] ring-1 ring-border/45 dark:bg-white/[0.08] dark:ring-white/[0.09] dark:shadow-[0_1px_0_rgba(255,255,255,0.07)_inset,0_4px_12px_-8px_rgba(0,0,0,0.55)]"
                          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                      )}
                    >
                      <Folder className="h-3.5 w-3.5" />
                      <span>{toolLabel}</span>
                      {scan.exists ? (
                        <span
                          className={cn(
                            "ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                            active
                              ? "bg-foreground/[0.08] text-foreground/85"
                              : "bg-muted/70 text-muted-foreground",
                          )}
                        >
                          {scan.skills.length}
                        </span>
                      ) : (
                        <span className="ml-0.5 text-[10px] text-muted-foreground/70">
                          {t("settings.skillsImportNotDetected")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-full"
                  disabled={loading || importing}
                  onClick={onRescan}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                  {t("settings.skillsImportRescan")}
                </Button>
                {!bulkMode ? (
                  <Button
                    size="sm"
                    className="gap-1.5 rounded-full"
                    disabled={selected.size === 0 || importing || loading}
                    onClick={() => onImport()}
                  >
                    {importing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {importing && importProgress
                      ? `${t("settings.skillsImportProgress")} ${importProgress.done + 1}/${importProgress.total}`
                      : `${t("settings.skillsImportButton")}${importableSelectedCount > 0 ? ` (${importableSelectedCount})` : ""}`}
                  </Button>
                ) : null}
              </div>
            </div>

            {bulkMode ? (
              <div className="hub-panel-enter flex items-center gap-2 text-[11px] text-muted-foreground/80">
                <ListChecks className="h-3.5 w-3.5 shrink-0" />
                <span>{t("settings.skillsBulkImportHint")}</span>
              </div>
            ) : null}

            {activeScan ? (
              <div key={activeScan.tool} className="hub-panel-enter flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/70">
                  <span className="font-mono">{activeScan.rootDir}</span>
                  {activeScan.tool === "codebuddy" && activeScan.exists ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t("settings.skillsImportCodebuddyHint")}</span>
                    </>
                  ) : null}
                  {activeScan.errors.length > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("settings.skillsImportUnparsable").replace(
                          "{count}",
                          String(activeScan.errors.length),
                        )}
                      </span>
                    </>
                  ) : null}
                  {activeScan.exists && activeScan.skills.length > 0 ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t("settings.skillsImportOverwriteHint")}</span>
                    </>
                  ) : null}
                </p>

                {!activeScan.exists ? (
                  <GlassPanel tone="muted">
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {t("settings.skillsImportNotDetected")} · {activeScan.rootDir}
                    </p>
                  </GlassPanel>
                ) : activeScan.skills.length === 0 ? (
                  <GlassPanel tone="muted">
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {t("settings.skillsImportEmpty")}
                    </p>
                  </GlassPanel>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {t("settings.skillsHubSelectedShort")} {selectedSelectableVisibleCount} /{" "}
                        {selectableVisibleBaseDirs.length}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-full"
                        disabled={importing || selectableVisibleBaseDirs.length === 0}
                        onClick={() =>
                          onBatchToggle(selectableVisibleBaseDirs, !allVisibleSelected)
                        }
                      >
                        <span
                          className={cn(
                            "flex h-3.5 w-3.5 items-center justify-center rounded border",
                            allVisibleSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border/70 bg-background",
                          )}
                          aria-hidden="true"
                        >
                          {allVisibleSelected ? <Check className="h-2.5 w-2.5" /> : null}
                        </span>
                        {allVisibleSelected
                          ? t("settings.skillsImportDeselectAll")
                          : t("settings.skillsImportSelectAll")}
                      </Button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {activeScan.skills.map((skill) => {
                        const alreadyInstalled = installedNames.has(skill.name);
                        const checked = !alreadyInstalled && selected.has(skill.baseDir);
                        const locked = alreadyInstalled || importing;
                        const installing = importing && skill.baseDir === importingExternalBaseDir;
                        return (
                          // biome-ignore lint/a11y/useSemanticElements: The card contains a separate import control.
                          <div
                            key={skill.baseDir}
                            role="button"
                            tabIndex={locked ? -1 : 0}
                            aria-disabled={locked}
                            aria-pressed={checked}
                            onMouseDown={(event) => {
                              if (bulkMode && event.shiftKey) event.preventDefault();
                            }}
                            onClick={(event) => {
                              if (locked) return;
                              const orderedBaseDirs = activeScan.skills
                                .filter((item) => !installedNames.has(item.name))
                                .map((item) => item.baseDir);
                              if (
                                bulkMode &&
                                event.shiftKey &&
                                bulkAnchorRef.current &&
                                bulkAnchorRef.current !== skill.baseDir
                              ) {
                                const from = orderedBaseDirs.indexOf(bulkAnchorRef.current);
                                const to = orderedBaseDirs.indexOf(skill.baseDir);
                                if (from !== -1 && to !== -1) {
                                  const [lo, hi] = from < to ? [from, to] : [to, from];
                                  onBatchToggle(orderedBaseDirs.slice(lo, hi + 1), !checked);
                                  bulkAnchorRef.current = skill.baseDir;
                                  return;
                                }
                              }
                              onToggle(skill.baseDir);
                              bulkAnchorRef.current = skill.baseDir;
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.target !== event.currentTarget ||
                                (event.key !== "Enter" && event.key !== " ")
                              ) {
                                return;
                              }
                              event.preventDefault();
                              event.currentTarget.click();
                            }}
                            className={cn(
                              "skill-card-enter group flex h-full min-h-[13rem] w-full flex-col rounded-2xl border p-3.5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-foreground/10",
                              alreadyInstalled
                                ? "border-emerald-500/40 bg-card shadow-sm dark:border-emerald-400/35"
                                : checked
                                  ? "border-primary/60 bg-card shadow-sm ring-1 ring-primary/20"
                                  : "border-border/70 bg-card shadow-xs hover:-translate-y-0.5 hover:border-border hover:bg-accent/25 hover:shadow-md",
                              importing && !alreadyInstalled ? "opacity-60" : null,
                            )}
                          >
                            <div className="flex h-full flex-col gap-3">
                              <div className="flex items-start gap-3">
                                <span
                                  className={cn(
                                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                                    alreadyInstalled
                                      ? "border-border/50 bg-muted/40 opacity-50"
                                      : checked
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border/70 bg-background",
                                  )}
                                >
                                  {!alreadyInstalled && checked ? (
                                    <Check className="h-3 w-3" />
                                  ) : null}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate text-[13px] font-semibold leading-tight text-foreground">
                                      {skill.name}
                                    </span>
                                    {alreadyInstalled ? (
                                      <span className="shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                        {t("settings.skillsImportInstalledBadge")}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                              <p
                                className="line-clamp-3 min-h-[3rem] text-[11.5px] leading-[1.45] text-muted-foreground"
                                title={skill.description}
                              >
                                {truncateLocalSkillCardDescription(skill.description)}
                              </p>
                              <div className="mt-auto space-y-2.5">
                                <span
                                  className="block truncate px-0.5 text-[10.5px] text-muted-foreground"
                                  title={skill.baseDir}
                                >
                                  {skill.baseDir}
                                </span>
                                <Button
                                  type="button"
                                  variant={alreadyInstalled ? "outline" : "default"}
                                  size="sm"
                                  className="h-10 w-full gap-1.5 rounded-xl"
                                  disabled={locked}
                                  aria-busy={installing}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onImport(skill);
                                  }}
                                >
                                  {installing ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : alreadyInstalled ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <Download className="h-3.5 w-3.5" />
                                  )}
                                  {installing
                                    ? t("settings.skillsImportProgress")
                                    : alreadyInstalled
                                      ? t("settings.skillsImportInstalledBadge")
                                      : t("settings.skillsBulkImportAction")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      {bulkMode ? (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center px-1 pt-2 max-sm:bottom-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="hub-panel-enter pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-full border border-border/50 bg-background/95 py-2 pl-4 pr-2 text-[12.5px] shadow-[0_8px_24px_-12px_rgba(15,23,42,0.35)] max-sm:justify-center max-sm:rounded-3xl max-sm:whitespace-nowrap dark:border-white/[0.1] dark:bg-popover/95">
            {importableSelectedCount > 0 || importing ? (
              <>
                <span className="whitespace-nowrap text-foreground/85">
                  {t("settings.skillsBulkSelectedCount").replace(
                    "{count}",
                    String(importableSelectedCount),
                  )}
                </span>
                <span className="hidden text-muted-foreground/50 sm:inline" aria-hidden="true">
                  │
                </span>
                <button
                  type="button"
                  disabled={importing || loading}
                  className="inline-flex h-7 items-center rounded-full bg-foreground px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => onImport()}
                >
                  {importing && importProgress ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      {`${t("settings.skillsImportProgress")} ${importProgress.done + 1}/${importProgress.total}`}
                    </>
                  ) : (
                    `${t("settings.skillsBulkImportAction")}${importableSelectedCount > 0 ? ` (${importableSelectedCount})` : ""}`
                  )}
                </button>
              </>
            ) : (
              <span className="text-muted-foreground">{t("settings.skillsBulkClickToSelect")}</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
