import { Select as SelectPrimitive } from "@base-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  BrushCleaning,
  Check,
  ChevronDown,
  Folder,
  Globe2,
  History,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from "../../components/icons";
import { pokeMemoryOrganizerRunner } from "../../components/memory/MemoryOrganizerRunner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useLocale } from "../../i18n";
import { buildModelOptions } from "../../lib/chat/page/chatPageHelpers";
import {
  formatMemoryError,
  type MemoryListResponse,
  type MemoryMeta,
  type MemoryOrganizeRun,
  type MemoryOrganizeRunStatus,
  type MemoryPathsInfo,
  type MemoryReadResponse,
  type MemoryType,
  memoryAccept,
  memoryApplyBatch,
  memoryDelete,
  memoryList,
  memoryOrganizeRunClearHistory,
  memoryOrganizeRunCreate,
  memoryOrganizeRunList,
  memoryOrganizeRunRead,
  memoryOrganizeRunUpdate,
  memoryPathsInfo,
  memoryRead,
  memoryUpdate,
  memoryWipeAll,
  memoryWrite,
} from "../../lib/memory/api";
import {
  appliedBatchCount,
  buildManualApplyState,
  buildReviewItemsForBatch,
  decisionsWithApplyStatus,
  deriveManualApplyDisplay,
  failedDecisionKeysFromReviewItems,
  inferOrganizerDecisionGroupIds,
  isDefaultSelectedOrganizerDecision,
  ORGANIZER_PROTOCOL_VERSION,
  type OrganizerReviewItem,
  type OrganizerSafeDecision,
  organizerDecisionKey,
  protocolManualApplyState,
  protocolObject,
  protocolRejectionBuckets,
  protocolSafeDecisions,
  protocolStringArray,
  reviewItemsFromProtocol,
  successfulDecisionKeys,
} from "../../lib/memory/organizerProtocol";
import { parseModelValue, toModelValue } from "../../lib/providers/llm";
import {
  type AppSettings,
  computeNextMemoryOrganizerRunAt,
  type MemoryOrganizerFrequency,
  type MemoryOrganizerMode,
  type MemoryOrganizerScope,
  updateMemorySettings,
} from "../../lib/settings";
import { AgentActivationSwitch } from "./shared";

type MemoryTab = "global" | "project" | "journal";

type MemoryModelOption = {
  value: string;
  label: string;
  providerName: string;
};

const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];
const MEMORY_ORGANIZER_FREQUENCIES: Array<{
  value: MemoryOrganizerFrequency;
  labelKey: string;
}> = [
  { value: "none", labelKey: "settings.memoryOrganizerNoSchedule" },
  { value: "daily", labelKey: "settings.memoryOrganizerEveryDay" },
  { value: "weekly", labelKey: "settings.memoryOrganizerEveryWeek" },
];
const MEMORY_ORGANIZER_SCOPES: Array<{ value: MemoryOrganizerScope; labelKey: string }> = [
  { value: "all", labelKey: "settings.memoryOrganizerScopeAll" },
  { value: "global", labelKey: "settings.memoryOrganizerScopeGlobal" },
  { value: "projects", labelKey: "settings.memoryOrganizerScopeAllProjects" },
  { value: "current-project", labelKey: "settings.memoryOrganizerScopeCurrentProject" },
];
const MEMORY_ORGANIZER_MODES: Array<{ value: MemoryOrganizerMode; labelKey: string }> = [
  { value: "conservative", labelKey: "settings.memoryOrganizerModeConservative" },
  { value: "standard", labelKey: "settings.memoryOrganizerModeStandard" },
  { value: "aggressive", labelKey: "settings.memoryOrganizerModeAggressive" },
];
const MEMORY_ORGANIZER_WEEKDAYS = [
  "settings.memoryOrganizerWeekdaySunday",
  "settings.memoryOrganizerWeekdayMonday",
  "settings.memoryOrganizerWeekdayTuesday",
  "settings.memoryOrganizerWeekdayWednesday",
  "settings.memoryOrganizerWeekdayThursday",
  "settings.memoryOrganizerWeekdayFriday",
  "settings.memoryOrganizerWeekdaySaturday",
];
const DRAWER_SELECT_NONE_VALUE = "__memory_drawer_none__";
const MEMORY_ORGANIZER_TIME_DEBOUNCE_MS = 400;
const MEMORY_ORGANIZER_RUN_REFRESH_POLL_MS = 2_000;

type DrawerSelectOption = {
  value: string;
  label: string;
  description?: string;
};

function DrawerSelect(props: {
  value: string;
  onValueChange: (value: string) => void;
  options: DrawerSelectOption[];
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { value, onValueChange, options, ariaLabel, placeholder, disabled, className } = props;
  const selected = options.find((option) => option.value === value);
  const triggerClass = [
    "group/drawer-select inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-foreground/[0.08] bg-white/55 px-3 text-[13px] leading-none text-foreground/90",
    "outline-none transition-[background-color,border-color,box-shadow] duration-150",
    "hover:border-foreground/[0.14] hover:bg-white/75",
    "data-[open]:border-foreground/[0.2] data-[open]:bg-white/85 data-[open]:shadow-[0_1px_0_rgba(255,255,255,0.65)_inset,0_2px_8px_-4px_rgba(15,23,42,0.08)]",
    "data-[placeholder]:text-muted-foreground",
    "focus-visible:outline-none focus-visible:ring-0",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "dark:bg-white/[0.04] dark:hover:bg-white/[0.06] dark:data-[open]:bg-white/[0.08]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(v) => {
        if (v != null) onValueChange(v as string);
      }}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger aria-label={ariaLabel} className={triggerClass}>
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectPrimitive.Value>{selected ? selected.label : placeholder}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 ease-out group-data-[open]/drawer-select:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          alignItemWithTrigger={false}
        >
          <SelectPrimitive.Popup
            className={[
              "drawer-select-content z-[80] overflow-hidden rounded-xl border border-foreground/[0.08] bg-background/95 p-1 text-[13px] text-foreground/90",
              "shadow-[0_24px_48px_-24px_rgba(15,23,42,0.32),0_2px_6px_-3px_rgba(15,23,42,0.18)] backdrop-blur-2xl",
              "min-w-[var(--anchor-width)]",
              "data-[open]:animate-in data-[closed]:animate-out",
              "data-[closed]:fade-out-0 data-[open]:fade-in-0",
              "data-[closed]:zoom-out-95 data-[open]:zoom-in-95",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
              "dark:bg-background/90",
            ].join(" ")}
          >
            <SelectPrimitive.List className="max-h-[min(320px,var(--available-height))] overflow-y-auto p-0.5">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  className={[
                    "relative flex w-full cursor-pointer select-none items-start gap-2 rounded-md py-1.5 pl-2.5 pr-8 leading-tight outline-none transition-colors",
                    "hover:bg-foreground/[0.05] data-[highlighted]:bg-foreground/[0.06] data-[highlighted]:text-foreground",
                    "data-[selected]:bg-primary/[0.08] data-[selected]:text-foreground",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
                  ].join(" ")}
                >
                  <span className="min-w-0 flex-1">
                    <SelectPrimitive.ItemText>
                      <span className="block truncate">{option.label}</span>
                    </SelectPrimitive.ItemText>
                    {option.description ? (
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  <SelectPrimitive.ItemIndicator className="absolute right-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function buildMemoryModelOptions(settings: AppSettings): MemoryModelOption[] {
  return buildModelOptions(settings).map((option) => ({
    value: option.value,
    label: option.label,
    providerName: option.providerName,
  }));
}

function memoryModelValue(model: AppSettings["memory"]["organizerModel"]) {
  return model ? toModelValue(model.customProviderId, model.model) : "";
}

function formatTime(value: number) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function dailyTitle(entry: { slug: string; dateLocal?: string | null }) {
  return entry.dateLocal || entry.slug.replace(/^daily-/, "") || entry.slug;
}

function entryTitle(entry: MemoryMeta) {
  return entry.memoryType === "daily" ? dailyTitle(entry) : entry.description || entry.slug;
}

function selectedTitle(entry: MemoryReadResponse) {
  return entry.memoryType === "daily" ? dailyTitle(entry) : entry.description || entry.slug;
}

function entryKey(entry: MemoryMeta) {
  return `${entry.scope}:${entry.workdirHash || ""}:${entry.slug}`;
}

function selectedEntryWorkdir(entry: MemoryMeta | null, fallbackWorkdir?: string) {
  if (!entry || entry.scope !== "project") return fallbackWorkdir;
  return entry.workdirPath?.trim() || fallbackWorkdir;
}

function memoryTypeLabel(
  type: MemoryMeta["memoryType"] | MemoryReadResponse["memoryType"],
  t: (key: string) => string,
) {
  switch (type) {
    case "user":
      return t("settings.memoryTypeUser");
    case "feedback":
      return t("settings.memoryTypeFeedback");
    case "project":
      return t("settings.memoryTypeProject");
    case "reference":
      return t("settings.memoryTypeReference");
    case "daily":
      return t("settings.memoryTypeDaily");
    default:
      return type;
  }
}

function memoryScopeLabel(scope: MemoryMeta["scope"], t: (key: string) => string) {
  return scope === "project" ? t("settings.memoryScopeProject") : t("settings.memoryScopeGlobal");
}

function organizerStatusLabel(status: MemoryOrganizeRunStatus, t: (key: string) => string) {
  switch (status) {
    case "pending":
      return t("settings.memoryOrganizerStatusPending");
    case "running":
      return t("settings.memoryOrganizerStatusRunning");
    case "succeeded":
      return t("settings.memoryOrganizerStatusSucceeded");
    case "failed":
      return t("settings.memoryOrganizerStatusFailed");
    case "skipped":
      return t("settings.memoryOrganizerStatusSkipped");
    case "cancelled":
      return t("settings.memoryOrganizerStatusCancelled");
    default:
      return status;
  }
}

function organizerStatusClass(status: MemoryOrganizeRunStatus) {
  if (status === "succeeded") {
    return "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "failed") {
    return "border-destructive/25 bg-destructive/[0.06] text-destructive";
  }
  if (status === "running" || status === "pending") {
    return "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300";
  }
  return "border-border/60 bg-muted/40 text-muted-foreground";
}

function organizerTriggerLabel(trigger: MemoryOrganizeRun["trigger"], t: (key: string) => string) {
  return trigger === "scheduled"
    ? t("settings.memoryOrganizerTriggerScheduled")
    : t("settings.memoryOrganizerTriggerManual");
}

function modelNameFromRun(run: MemoryOrganizeRun) {
  const model =
    run.model && typeof run.model === "object"
      ? (run.model as { model?: unknown }).model
      : undefined;
  return typeof model === "string" && model.trim() ? model.trim() : "-";
}

function isOrganizerRunActive(run: Pick<MemoryOrganizeRun, "status"> | null | undefined) {
  return run?.status === "pending" || run?.status === "running";
}

function organizerRiskLabel(risk: OrganizerSafeDecision["riskLevel"], t: (key: string) => string) {
  if (risk === "high") return t("settings.memoryOrganizerRiskHigh");
  if (risk === "medium") return t("settings.memoryOrganizerRiskMedium");
  return t("settings.memoryOrganizerRiskLow");
}

function organizerRiskClass(risk: OrganizerSafeDecision["riskLevel"]) {
  if (risk === "high") {
    return "border-destructive/35 bg-destructive/[0.06] text-destructive";
  }
  if (risk === "medium") {
    return "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300";
  }
  return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300";
}

function organizerApplyStatusLabel(
  status: OrganizerSafeDecision["applyStatus"],
  t: (key: string) => string,
) {
  if (status === "applied") return t("settings.memoryOrganizerDecisionApplied");
  if (status === "failed") return t("settings.memoryOrganizerDecisionFailed");
  if (status === "skipped") return t("settings.memoryOrganizerDecisionSkipped");
  return "";
}

function organizerApplyStatusClass(status: OrganizerSafeDecision["applyStatus"]) {
  if (status === "applied") {
    return "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300";
  }
  if (status === "failed") {
    return "border-destructive/35 bg-destructive/[0.06] text-destructive";
  }
  if (status === "skipped") {
    return "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300";
  }
  return "border-border/60 text-muted-foreground";
}

function organizerReviewItemLabel(item: OrganizerReviewItem, t: (key: string) => string) {
  if (item.phase === "apply") return t("settings.memoryOrganizerReviewItemApply");
  if (item.kind === "error") return t("settings.memoryOrganizerReviewItemError");
  if (item.kind === "skipped") return t("settings.memoryOrganizerReviewItemSkipped");
  return t("settings.memoryOrganizerReviewItemReview");
}

function organizerReviewItemClass(item: OrganizerReviewItem) {
  if (item.severity === "error" || item.kind === "error") {
    return "border-destructive/30 bg-destructive/[0.06] text-destructive";
  }
  if (item.kind === "skipped" || item.severity === "warning") {
    return "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300";
  }
  return "border-border/60 bg-muted/30 text-muted-foreground";
}

function manualApplySummaryText(input: {
  selectedCount: number;
  appliedCount: number;
  warningCount: number;
}) {
  if (input.warningCount === 0) {
    return `手动应用结果：已选择 ${input.selectedCount} 条建议，${input.appliedCount} 条写入成功。`;
  }
  if (input.appliedCount > 0) {
    return `手动应用结果：已选择 ${input.selectedCount} 条建议，${input.appliedCount} 条写入成功，${input.warningCount} 条失败或跳过。`;
  }
  return `手动应用结果：已选择 ${input.selectedCount} 条建议，全部未写入，${input.warningCount} 条失败或跳过。`;
}

function displayedFinalSummary(
  run: MemoryOrganizeRun,
  manualDisplay: ReturnType<typeof deriveManualApplyDisplay>,
) {
  if (manualDisplay.status === "partial" || manualDisplay.status === "failed") {
    const summary = manualApplySummaryText(manualDisplay);
    const final = run.finalSummary?.trim();
    if (!final) return summary;
    if (final.includes("手动应用结果")) return final;
    return `${summary}\n\n模型原始总结：${final}`;
  }
  return run.finalSummary || run.error || "";
}

function projectLabel(entry: MemoryMeta, t: (key: string) => string) {
  const path = entry.workdirPath?.trim();
  if (path) return path;
  return `${t("settings.memoryUnknownProject")} · ${
    entry.workdirHash || t("settings.memoryUnknownProjectId")
  }`;
}

function matchesFilter(entry: MemoryMeta, filter: string) {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return [
    entry.slug,
    entry.memoryType,
    entry.scope,
    entry.description,
    entryTitle(entry),
    entry.workdirHash,
    entry.workdirPath,
  ]
    .join("\n")
    .toLowerCase()
    .includes(q);
}

type MemoryQuota = MemoryListResponse["quota"];
type MemoryScopeQuota = NonNullable<MemoryQuota["scopeQuotas"]>[number];
type QuotaLevel = "healthy" | "warning" | "danger" | "full";

function fallbackScopeQuotas(
  entries: MemoryMeta[],
  quota: MemoryQuota | null,
  hasWorkdir: boolean,
): MemoryScopeQuota[] {
  const projectUsed = entries.filter(
    (entry) => entry.memoryType !== "daily" && entry.scope === "project",
  ).length;
  if (quota?.scopeQuotas?.length) {
    const items = [...quota.scopeQuotas];
    if (projectUsed > 0 && !items.some((item) => item.scope === "project")) {
      items.push({
        scope: "project",
        workdirHash: "all",
        used: projectUsed,
        limit: quota.limit,
      });
    }
    return items;
  }
  const limit = quota?.limit ?? 500;
  const globalUsed = entries.filter(
    (entry) => entry.memoryType !== "daily" && entry.scope === "global",
  ).length;
  return [
    { scope: "global", workdirHash: "", used: globalUsed, limit },
    ...(hasWorkdir || projectUsed > 0
      ? [{ scope: "project" as const, workdirHash: "", used: projectUsed, limit }]
      : []),
  ];
}

function quotaLevel(quota: MemoryScopeQuota): QuotaLevel {
  if (quota.limit <= 0) return "healthy";
  const ratio = quota.used / quota.limit;
  if (quota.used >= quota.limit) return "full";
  if (ratio >= 0.95) return "danger";
  if (ratio >= 0.8) return "warning";
  return "healthy";
}

function strongestQuotaLevel(items: MemoryScopeQuota[]): QuotaLevel {
  if (items.some((item) => quotaLevel(item) === "full")) return "full";
  if (items.some((item) => quotaLevel(item) === "danger")) return "danger";
  if (items.some((item) => quotaLevel(item) === "warning")) return "warning";
  return "healthy";
}

function quotaPillClass(level: QuotaLevel) {
  if (level === "full" || level === "danger") {
    return "border-red-500/25 bg-red-500/[0.06] text-red-700 dark:text-red-300";
  }
  if (level === "warning") {
    return "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300";
  }
  return "border-border/60 text-muted-foreground";
}

function quotaStatusClass(level: QuotaLevel) {
  if (level === "full" || level === "danger") {
    return "border-red-500/25 bg-red-500/[0.06] text-red-700 dark:text-red-300";
  }
  if (level === "warning") {
    return "border-amber-500/25 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300";
  }
  return "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
}

function quotaStatusLabelKey(level: QuotaLevel) {
  if (level === "full") return "settings.memoryQuotaFull";
  if (level === "danger") return "settings.memoryQuotaNearLimit";
  if (level === "warning") return "settings.memoryQuotaWarning";
  return "settings.memoryHealthy";
}

function MemoryOrganizerHistoryModal(props: {
  t: (key: string) => string;
  onClose: () => void;
  workdir?: string;
  onMemoryChanged?: () => void;
}) {
  const { t, onClose, workdir, onMemoryChanged } = props;
  const [runs, setRuns] = useState<MemoryOrganizeRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<MemoryOrganizeRun | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | MemoryOrganizeRunStatus>("all");
  const [loading, setLoading] = useState(false);
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [selectedDecisionKeys, setSelectedDecisionKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);

  async function reload(
    selectRunId?: string,
    options?: { quiet?: boolean; keepSelection?: boolean },
  ) {
    const quiet = options?.quiet === true;
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await memoryOrganizeRunList({
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 80,
      });
      setRuns(response.runs);
      const nextId =
        selectRunId ||
        (options?.keepSelection === false ? undefined : selectedRun?.runId) ||
        response.runs[0]?.runId;
      const next = nextId ? await memoryOrganizeRunRead({ runId: nextId }) : null;
      setSelectedRun(next ?? response.runs[0] ?? null);
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const hasActiveRun = runs.some(isOrganizerRunActive) || isOrganizerRunActive(selectedRun);

  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = window.setInterval(() => {
      void reload(selectedRun?.runId, { quiet: true });
    }, 2_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveRun, selectedRun?.runId, statusFilter]);

  const selectedProtocol = protocolObject(selectedRun);
  const clusterSummaries = protocolStringArray(selectedProtocol.clusterSummaries);
  const rawBlocks = Array.isArray(selectedProtocol.raw) ? selectedProtocol.raw : [];
  const reviewItems = reviewItemsFromProtocol(selectedProtocol);
  const manualApplyState = protocolManualApplyState(selectedProtocol.manualApplyState);
  const parsedSafeDecisions = protocolSafeDecisions(selectedProtocol.safeDecisions);
  const safeDecisions = decisionsWithApplyStatus(
    parsedSafeDecisions,
    manualApplyState,
    reviewItems,
  );
  const rejectionBuckets = protocolRejectionBuckets(selectedProtocol.rejectionBuckets);
  const manualApplyDisplay = deriveManualApplyDisplay({
    run: selectedRun,
    safeDecisions,
    reviewItems,
    manualApplyState,
  });
  const canApplyManualPreview =
    selectedRun?.trigger === "manual" &&
    selectedRun.status === "succeeded" &&
    manualApplyDisplay.status === "pending" &&
    safeDecisions.length > 0;

  useEffect(() => {
    if (!canApplyManualPreview) {
      setSelectedDecisionKeys(new Set());
      return;
    }
    setSelectedDecisionKeys(
      new Set(
        safeDecisions
          .map((decision, index) => ({ decision, key: organizerDecisionKey(decision, index) }))
          .filter(({ decision }) => isDefaultSelectedOrganizerDecision(decision))
          .map(({ key }) => key),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRun?.runId, canApplyManualPreview, safeDecisions.length]);

  function togglePreviewDecision(key: string) {
    setSelectedDecisionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function applyManualPreview() {
    if (!selectedRun) return;
    const selectedWithKeys = parsedSafeDecisions
      .map((decision, index) => ({ decision, key: organizerDecisionKey(decision, index) }))
      .filter((item) => selectedDecisionKeys.has(item.key));
    const selected = inferOrganizerDecisionGroupIds(selectedWithKeys.map((item) => item.decision));
    const selectedWithGroupedKeys = selectedWithKeys.map((item, index) => ({
      ...item,
      decision: selected[index],
    }));
    if (selectedWithGroupedKeys.length === 0) {
      setError(t("settings.memoryOrganizerSelectAtLeastOne"));
      return;
    }
    setApplyingPreview(true);
    setError(null);
    try {
      const batch = await memoryApplyBatch({
        workdir,
        trigger: "memory-organize",
        model: modelNameFromRun(selectedRun),
        decisions: selected,
      });
      const appliedCount = appliedBatchCount(batch);
      const nextReviewItems = buildReviewItemsForBatch(batch, selectedWithGroupedKeys);
      const appliedDecisionKeys = successfulDecisionKeys(selectedWithGroupedKeys, batch);
      const failedDecisionKeys = failedDecisionKeysFromReviewItems(
        selectedWithGroupedKeys,
        nextReviewItems,
      );
      const manualApplyStateForProtocol = buildManualApplyState({
        selectedCount: selectedWithGroupedKeys.length,
        appliedCount,
        warningCount: nextReviewItems.length,
        appliedDecisionKeys,
        failedDecisionKeys,
      });
      const appliedKeySet = new Set(appliedDecisionKeys);
      const failedKeySet = new Set(failedDecisionKeys);
      const safeDecisionsForProtocol = parsedSafeDecisions.map((decision, index) => {
        const key = organizerDecisionKey(decision, index);
        const grouped =
          selectedWithGroupedKeys.find((item) => item.key === key)?.decision ?? decision;
        if (failedKeySet.has(key)) return { ...grouped, applyStatus: "failed" as const };
        if (appliedKeySet.has(key)) return { ...grouped, applyStatus: "applied" as const };
        return grouped;
      });
      const manualSummary = manualApplySummaryText(manualApplyStateForProtocol);
      const existingFinalSummary = selectedRun.finalSummary?.trim() || "";
      await memoryOrganizeRunUpdate({
        runId: selectedRun.runId,
        safeApplied: appliedCount,
        createdCount: batch.created.length,
        updatedCount: batch.updated.length,
        deletedCount: batch.deleted.length,
        reviewSkipped: selectedRun.reviewSkipped + nextReviewItems.length,
        finalSummary: existingFinalSummary.includes("手动应用结果")
          ? manualSummary
          : `${manualSummary}${existingFinalSummary ? `\n\n模型原始总结：${existingFinalSummary}` : ""}`,
        trimmedProtocol: {
          ...selectedProtocol,
          version: ORGANIZER_PROTOCOL_VERSION,
          reviewItems: [...reviewItems, ...nextReviewItems],
          safeDecisions: safeDecisionsForProtocol,
          manualApplyState: manualApplyStateForProtocol,
        },
      });
      await reload(selectedRun.runId);
      onMemoryChanged?.();
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setApplyingPreview(false);
    }
  }

  async function clearHistory() {
    setClearingHistory(true);
    setError(null);
    setHistoryFeedback(null);
    try {
      const response = await memoryOrganizeRunClearHistory();
      setClearConfirmOpen(false);
      setSelectedRun(null);
      setSelectedDecisionKeys(new Set());
      setHistoryFeedback(
        response.retainedActiveCount > 0
          ? t("settings.memoryOrganizerHistoryClearedActiveRetained")
          : t("settings.memoryOrganizerHistoryCleared"),
      );
      await reload(undefined, { keepSelection: false });
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setClearingHistory(false);
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-organizer-history-title"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative z-10 flex h-[min(760px,calc(100vh-2rem))] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-4">
            <div className="min-w-0">
              <div id="memory-organizer-history-title" className="text-sm font-semibold">
                {t("settings.memoryOrganizerHistory")}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("settings.memoryOrganizerHistoryDescription")}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              title={t("settings.memorySettingsClose")}
              aria-label={t("settings.memorySettingsClose")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-border/50">
              <div className="space-y-2 border-b border-border/40 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <DrawerSelect
                      value={statusFilter}
                      onValueChange={(next) =>
                        setStatusFilter(next as "all" | MemoryOrganizeRunStatus)
                      }
                      ariaLabel={t("settings.memoryOrganizerHistoryAll")}
                      options={[
                        { value: "all", label: t("settings.memoryOrganizerHistoryAll") },
                        { value: "succeeded", label: t("settings.memoryOrganizerStatusSucceeded") },
                        { value: "failed", label: t("settings.memoryOrganizerStatusFailed") },
                        { value: "skipped", label: t("settings.memoryOrganizerStatusSkipped") },
                        { value: "running", label: t("settings.memoryOrganizerStatusRunning") },
                      ]}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title={t("settings.memoryOrganizerClearHistory")}
                    aria-label={t("settings.memoryOrganizerClearHistory")}
                    onClick={() => setClearConfirmOpen(true)}
                    disabled={loading || clearingHistory || runs.length === 0}
                  >
                    <BrushCleaning className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => reload()}
                  disabled={loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  {t("settings.memoryRefresh")}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {runs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">
                    {t("settings.memoryOrganizerHistoryEmpty")}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {runs.map((run) => {
                      const active = selectedRun?.runId === run.runId;
                      return (
                        <button
                          key={run.runId}
                          type="button"
                          onClick={() => reload(run.runId)}
                          className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            active
                              ? "border-primary/50 bg-primary/5"
                              : "border-border/50 bg-background/70 hover:bg-muted/35"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerStatusClass(run.status)}`}
                            >
                              {organizerStatusLabel(run.status, t)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {organizerTriggerLabel(run.trigger, t)}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs font-medium">
                            {run.finalSummary ||
                              run.error ||
                              t("settings.memoryOrganizerHistoryPending")}
                          </div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            {formatTime(run.startedAt || run.createdAt)} · {modelNameFromRun(run)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <section className="min-h-0 overflow-auto p-5">
              {error ? (
                <div className="mb-4 whitespace-pre-wrap rounded-lg border border-destructive/20 bg-destructive/[0.05] px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              ) : null}
              {historyFeedback ? (
                <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  {historyFeedback}
                </div>
              ) : null}
              {selectedRun ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded border px-2 py-1 text-xs ${organizerStatusClass(selectedRun.status)}`}
                        >
                          {organizerStatusLabel(selectedRun.status, t)}
                        </span>
                        <span className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground">
                          {organizerTriggerLabel(selectedRun.trigger, t)}
                        </span>
                        <span className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground">
                          {selectedRun.scope} / {selectedRun.mode}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {selectedRun.runId}
                      </div>
                    </div>
                    <div className="grid shrink-0 grid-cols-[auto_minmax(9rem,auto)] gap-x-2 gap-y-1 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">
                        {t("settings.memoryOrganizerStarted")}
                      </span>
                      <span className="whitespace-nowrap text-right font-mono text-foreground/80">
                        {formatTime(selectedRun.startedAt || selectedRun.createdAt)}
                      </span>
                      <span className="whitespace-nowrap">
                        {t("settings.memoryOrganizerFinished")}
                      </span>
                      <span className="whitespace-nowrap text-right font-mono text-foreground/80">
                        {selectedRun.finishedAt ? formatTime(selectedRun.finishedAt) : "-"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-muted/15 p-4">
                    <div className="mb-2 text-xs font-semibold text-muted-foreground">
                      {t("settings.memoryOrganizerFinalSummary")}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {displayedFinalSummary(selectedRun, manualApplyDisplay) ||
                        t("settings.memoryOrganizerHistoryPending")}
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ["settings.memoryOrganizerInputCount", selectedRun.inputCount],
                      ["settings.memoryOrganizerClusterCount", selectedRun.clusterCount],
                      ["settings.memoryOrganizerSafeApplied", selectedRun.safeApplied],
                      ["settings.memoryOrganizerReviewSkipped", selectedRun.reviewSkipped],
                      ["settings.memoryOrganizerCreatedCount", selectedRun.createdCount],
                      ["settings.memoryOrganizerUpdatedCount", selectedRun.updatedCount],
                      ["settings.memoryOrganizerDeletedCount", selectedRun.deletedCount],
                      ["settings.memoryOrganizerParseFailures", selectedRun.parseFailures],
                    ].map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-lg border border-border/50 bg-background/70 p-3"
                      >
                        <div className="text-[11px] text-muted-foreground">{t(String(key))}</div>
                        <div className="mt-1 text-lg font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>

                  {safeDecisions.length > 0 ? (
                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground">
                            {t("settings.memoryOrganizerManualPreview")}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {manualApplyDisplay.status === "applied"
                              ? t("settings.memoryOrganizerApplied")
                              : manualApplyDisplay.status === "partial"
                                ? t("settings.memoryOrganizerPartiallyApplied")
                                : manualApplyDisplay.status === "failed"
                                  ? t("settings.memoryOrganizerApplyFailed")
                                  : t("settings.memoryOrganizerManualPreviewDescription")}
                          </div>
                        </div>
                        {canApplyManualPreview ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={applyManualPreview}
                            disabled={applyingPreview}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {t("settings.memoryOrganizerApplySelected")}
                          </Button>
                        ) : null}
                      </div>
                      <div className="mt-3 space-y-2">
                        {safeDecisions.map((decision, index) => {
                          const key = organizerDecisionKey(decision, index);
                          const checked =
                            manualApplyDisplay.status && manualApplyDisplay.status !== "pending"
                              ? manualApplyDisplay.appliedDecisionKeys.size === 0
                                ? decision.applyStatus !== "failed"
                                : manualApplyDisplay.appliedDecisionKeys.has(key)
                              : selectedDecisionKeys.has(key);
                          return (
                            <label
                              key={key}
                              className="flex gap-3 rounded-md border border-border/50 bg-background/70 p-3 text-xs"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 shrink-0"
                                checked={checked}
                                disabled={!canApplyManualPreview || applyingPreview}
                                onChange={() => togglePreviewDecision(key)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                    {decision.op === "delete"
                                      ? t("settings.memoryOrganizerDecisionDelete")
                                      : t("settings.memoryOrganizerDecisionUpsert")}
                                  </span>
                                  <span className="font-mono text-[11px]">{decision.slug}</span>
                                  {decision.scope ? (
                                    <span className="text-[11px] text-muted-foreground">
                                      {decision.scope}
                                      {decision.workdirHash ? `:${decision.workdirHash}` : ""}
                                    </span>
                                  ) : null}
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerRiskClass(decision.riskLevel)}`}
                                  >
                                    {organizerRiskLabel(decision.riskLevel, t)}
                                  </span>
                                  {decision.confidence != null ? (
                                    <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {t("settings.memoryOrganizerConfidence")}{" "}
                                      {decision.confidence.toFixed(2)}
                                    </span>
                                  ) : null}
                                  {decision.requiresUserAck ? (
                                    <span className="rounded border border-amber-500/30 bg-amber-500/[0.06] px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                      {t("settings.memoryOrganizerRequiresAck")}
                                    </span>
                                  ) : null}
                                  {decision.applyStatus ? (
                                    <span
                                      className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerApplyStatusClass(decision.applyStatus)}`}
                                    >
                                      {organizerApplyStatusLabel(decision.applyStatus, t)}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-1 block break-words text-muted-foreground">
                                  {decision.reason || decision.description || "-"}
                                </span>
                                {decision.applyError?.message ? (
                                  <span className="mt-1 block break-words text-destructive">
                                    {decision.applyError.message}
                                  </span>
                                ) : null}
                                {decision.sourceSlugs?.length ? (
                                  <span className="mt-1 block break-words font-mono text-[10px] text-muted-foreground">
                                    {t("settings.memoryOrganizerSources")}{" "}
                                    {decision.sourceSlugs.join(", ")}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {rejectionBuckets.length > 0 ? (
                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-3 text-xs font-semibold text-muted-foreground">
                        {t("settings.memoryOrganizerRejectionBuckets")}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {rejectionBuckets.map(([key, count]) => (
                          <div
                            key={key}
                            className="rounded-md border border-border/50 bg-background/70 px-3 py-2"
                          >
                            <div className="text-[11px] text-muted-foreground">{t(key)}</div>
                            <div className="mt-1 text-sm font-semibold">{count}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {reviewItems.length > 0 ? (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4">
                      <div className="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        {t("settings.memoryOrganizerReviewNotes")}
                      </div>
                      <ul className="space-y-2 text-xs text-muted-foreground">
                        {reviewItems.map((item, index) => (
                          <li
                            key={`${index}:${item.phase}:${item.slug || ""}:${item.message}`}
                            className="rounded-md border border-border/50 bg-background/70 px-3 py-2"
                          >
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerReviewItemClass(item)}`}
                              >
                                {organizerReviewItemLabel(item, t)}
                              </span>
                              {item.code ? (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {item.code}
                                </span>
                              ) : null}
                              {item.slug ? (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {item.slug}
                                </span>
                              ) : null}
                            </div>
                            <div className="break-words">{item.message}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {clusterSummaries.length > 0 ? (
                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">
                        {t("settings.memoryOrganizerClusterSummaries")}
                      </div>
                      <div className="space-y-2">
                        {clusterSummaries.map((summary, index) => (
                          <div
                            key={`${index}:${summary}`}
                            className="rounded bg-muted/30 px-3 py-2 text-xs"
                          >
                            {summary}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {rawBlocks.length > 0 ? (
                    <details className="rounded-lg border border-border/60 p-4">
                      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                        {t("settings.memoryOrganizerTrimmedProtocol")}
                      </summary>
                      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-3 text-[11px]">
                        {JSON.stringify(rawBlocks, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t("settings.memoryOrganizerHistoryEmpty")}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
      {clearConfirmOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-organizer-clear-history-title"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setClearConfirmOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border bg-background shadow-2xl">
            <div className="flex items-start gap-3 border-b px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <div id="memory-organizer-clear-history-title" className="text-sm font-semibold">
                  {t("settings.memoryOrganizerClearHistoryConfirmTitle")}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.memoryOrganizerClearHistoryConfirmDescription")}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setClearConfirmOpen(false)}
                disabled={clearingHistory}
              >
                {t("settings.memoryCancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={clearHistory}
                disabled={clearingHistory}
              >
                <BrushCleaning className="h-3.5 w-3.5" />
                {t("settings.memoryOrganizerClearHistory")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

function MemorySettingsDrawer(props: {
  modelOptions: MemoryModelOption[];
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  workdir?: string;
  saving: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onRequestWipe: () => void | Promise<void>;
  onOrganizerRunQueued?: (runId: string) => void;
  onMemoryChanged?: () => void;
}) {
  const {
    modelOptions,
    settings,
    setSettings,
    workdir,
    saving,
    t,
    onClose,
    onRequestWipe,
    onOrganizerRunQueued,
    onMemoryChanged,
  } = props;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [organizerFeedback, setOrganizerFeedback] = useState<string | null>(null);
  const [organizerSubmitting, setOrganizerSubmitting] = useState(false);
  const [drawerWipeConfirmOpen, setDrawerWipeConfirmOpen] = useState(false);
  const memoryOrganizerModel = memoryModelValue(settings.memory.organizerModel);
  const conversationSummaryModel = memoryModelValue(settings.memory.summaryModel);
  const committedTimeLocal = settings.memory.organizerSchedule.timeLocal;
  const [timeLocalDraft, setTimeLocalDraft] = useState(committedTimeLocal);
  const committedTimeLocalRef = useRef(committedTimeLocal);
  const timeLocalDraftRef = useRef(timeLocalDraft);
  const canEnableOrganizer = memoryOrganizerModel.trim().length > 0;
  const organizerTimingDisabled =
    !settings.memory.organizerEnabled || settings.memory.organizerSchedule.frequency === "none";

  useEffect(() => {
    committedTimeLocalRef.current = committedTimeLocal;
    setTimeLocalDraft(committedTimeLocal);
  }, [committedTimeLocal]);

  useEffect(() => {
    timeLocalDraftRef.current = timeLocalDraft;
  }, [timeLocalDraft]);

  useEffect(() => {
    if (timeLocalDraft === committedTimeLocal) return;
    const timeout = window.setTimeout(() => {
      updateOrganizerSchedule({ timeLocal: timeLocalDraft });
    }, MEMORY_ORGANIZER_TIME_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLocalDraft, committedTimeLocal]);

  useEffect(() => {
    return () => {
      const draft = timeLocalDraftRef.current;
      if (draft !== committedTimeLocalRef.current) {
        updateOrganizerSchedule({ timeLocal: draft });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      (!canEnableOrganizer || settings.memory.organizerSchedule.frequency === "none") &&
      settings.memory.organizerEnabled
    ) {
      setSettings((prev) =>
        updateMemorySettings(prev, {
          organizerEnabled: false,
          organizerNextRunAt: undefined,
        }),
      );
    }
  }, [
    canEnableOrganizer,
    setSettings,
    settings.memory.organizerEnabled,
    settings.memory.organizerSchedule.frequency,
  ]);

  const memoryModelDrawerOptions = useMemo<DrawerSelectOption[]>(
    () => [
      { value: DRAWER_SELECT_NONE_VALUE, label: t("settings.memoryModelNone") },
      ...modelOptions.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.providerName,
      })),
    ],
    [modelOptions, t],
  );

  function renderModelSelect(value: string, onChange: (value: string) => void, ariaLabel: string) {
    return (
      <DrawerSelect
        value={value.length > 0 ? value : DRAWER_SELECT_NONE_VALUE}
        onValueChange={(next) => onChange(next === DRAWER_SELECT_NONE_VALUE ? "" : next)}
        options={memoryModelDrawerOptions}
        ariaLabel={ariaLabel}
        placeholder={t("settings.memoryModelNone")}
      />
    );
  }

  function handleOrganizerModelChange(value: string) {
    const selected = parseModelValue(value) ?? undefined;
    setSettings((prev) => updateMemorySettings(prev, { organizerModel: selected }));
    if (!selected) {
      setSettings((prev) =>
        updateMemorySettings(prev, {
          organizerEnabled: false,
          organizerNextRunAt: undefined,
        }),
      );
    }
  }

  function handleSummaryModelChange(value: string) {
    setSettings((prev) =>
      updateMemorySettings(prev, {
        summaryModel: parseModelValue(value) ?? undefined,
      }),
    );
  }

  function handleOrganizerToggle() {
    if (!canEnableOrganizer) return;
    setSettings((prev) => {
      const enabled =
        !prev.memory.organizerEnabled || prev.memory.organizerSchedule.frequency === "none";
      const organizerSchedule =
        enabled && prev.memory.organizerSchedule.frequency === "none"
          ? { ...prev.memory.organizerSchedule, frequency: "daily" as MemoryOrganizerFrequency }
          : prev.memory.organizerSchedule;
      return updateMemorySettings(prev, {
        organizerEnabled: enabled,
        organizerSchedule,
        organizerNextRunAt: enabled
          ? computeNextMemoryOrganizerRunAt(organizerSchedule)
          : undefined,
      });
    });
  }

  function updateOrganizerSchedule(patch: Partial<AppSettings["memory"]["organizerSchedule"]>) {
    setSettings((prev) => {
      const organizerSchedule = {
        ...prev.memory.organizerSchedule,
        ...patch,
      };
      const enabledByFrequency = patch.frequency === "daily" || patch.frequency === "weekly";
      const organizerEnabled =
        organizerSchedule.frequency !== "none" &&
        Boolean(prev.memory.organizerModel) &&
        (prev.memory.organizerEnabled || enabledByFrequency);
      return updateMemorySettings(prev, {
        organizerSchedule,
        organizerEnabled,
        organizerNextRunAt: organizerEnabled
          ? computeNextMemoryOrganizerRunAt(organizerSchedule)
          : undefined,
      });
    });
  }

  function flushOrganizerTimeLocal() {
    if (timeLocalDraft !== settings.memory.organizerSchedule.timeLocal) {
      updateOrganizerSchedule({ timeLocal: timeLocalDraft });
    }
  }

  async function handleRunNow() {
    setOrganizerFeedback(null);
    if (!settings.memory.organizerModel) {
      setOrganizerFeedback(t("settings.memoryOrganizerNoModel"));
      return;
    }
    setOrganizerSubmitting(true);
    try {
      const response = await memoryOrganizeRunCreate({
        trigger: "manual",
        model: settings.memory.organizerModel,
        scope: settings.memory.organizerScope,
        mode: settings.memory.organizerMode,
      });
      const runId = response.run?.runId ?? response.activeRun?.runId;
      if (runId) {
        onOrganizerRunQueued?.(runId);
      }
      if (response.alreadyRunning) {
        setOrganizerFeedback(t("settings.memoryOrganizerAlreadyRunning"));
        setHistoryOpen(true);
        return;
      }
      const runnerPoked = pokeMemoryOrganizerRunner();
      setOrganizerFeedback(
        t(runnerPoked ? "settings.memoryOrganizerQueued" : "settings.memoryOrganizerQueuedRemote"),
      );
      setHistoryOpen(true);
    } catch (err) {
      setOrganizerFeedback(formatMemoryError(err));
    } finally {
      setOrganizerSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="skills-drawer-backdrop fixed inset-0 z-50 flex justify-end bg-foreground/[0.04] backdrop-blur-md dark:bg-background/30"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-settings-drawer-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside className="skills-drawer-panel relative flex h-full w-full flex-col overflow-hidden border-l border-foreground/[0.06] bg-background/65 shadow-[-30px_0_70px_-32px_rgba(15,23,42,0.28)] backdrop-blur-2xl sm:max-w-[420px] dark:border-foreground/[0.08] dark:bg-background/55">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent dark:via-white/10"
        />
        <div className="relative flex items-center gap-3 border-b border-foreground/[0.06] px-6 py-[18px]">
          <div className="min-w-0 flex-1">
            <div
              id="memory-settings-drawer-title"
              className="text-[15px] font-semibold leading-tight tracking-tight text-foreground/95"
            >
              {t("settings.memorySettingsTitle")}
            </div>
            <div className="mt-1 text-[11.5px] leading-snug text-muted-foreground/80">
              {t("settings.memorySettingsLocalOnly")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.05] text-muted-foreground/80 transition-colors hover:bg-foreground/[0.1] hover:text-foreground"
            title={t("settings.memorySettingsClose")}
            aria-label={t("settings.memorySettingsClose")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-6">
            <section className="space-y-2">
              <div className="px-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/65">
                {t("settings.memoryDriverModels")}
              </div>
              <div className="rounded-2xl border border-foreground/[0.06] bg-white/55 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_6px_16px_-12px_rgba(15,23,42,0.08)] backdrop-blur-md dark:bg-white/[0.035] dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
                <label className="block space-y-1.5">
                  <span className="text-[11.5px] text-muted-foreground/90">
                    {t("settings.memoryOrganizerModel")}
                  </span>
                  {renderModelSelect(
                    memoryOrganizerModel,
                    handleOrganizerModelChange,
                    t("settings.memoryOrganizerModel"),
                  )}
                </label>
                <div className="my-3 h-px bg-foreground/[0.05]" />
                <label className="block space-y-1.5">
                  <span className="text-[11.5px] text-muted-foreground/90">
                    {t("settings.memorySummaryModel")}
                  </span>
                  {renderModelSelect(
                    conversationSummaryModel,
                    handleSummaryModelChange,
                    t("settings.memorySummaryModel"),
                  )}
                </label>
                {modelOptions.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
                    {t("settings.memoryModelEmpty")}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/65">
                  {t("settings.memoryOrganizerTitle")}
                </div>
                <AgentActivationSwitch
                  checked={settings.memory.organizerEnabled}
                  title={t("settings.memoryOrganizerToggle")}
                  disabled={!canEnableOrganizer}
                  onToggle={handleOrganizerToggle}
                />
              </div>
              <div className="rounded-2xl border border-foreground/[0.06] bg-white/55 p-4 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_6px_16px_-12px_rgba(15,23,42,0.08)] backdrop-blur-md dark:bg-white/[0.035] dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
                <div className="space-y-3">
                  <div className="grid grid-cols-[1fr_108px] gap-2.5">
                    <label className="block space-y-1.5">
                      <span className="text-[11.5px] text-muted-foreground/90">
                        {t("settings.memoryOrganizerSchedule")}
                      </span>
                      <DrawerSelect
                        value={settings.memory.organizerSchedule.frequency}
                        disabled={!canEnableOrganizer}
                        onValueChange={(next) =>
                          updateOrganizerSchedule({
                            frequency: next as MemoryOrganizerFrequency,
                          })
                        }
                        ariaLabel={t("settings.memoryOrganizerSchedule")}
                        options={MEMORY_ORGANIZER_FREQUENCIES.map((item) => ({
                          value: item.value,
                          label: t(item.labelKey),
                        }))}
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11.5px] text-muted-foreground/90">
                        {t("settings.memoryOrganizerTime")}
                      </span>
                      <input
                        type="time"
                        aria-label={t("settings.memoryOrganizerTime")}
                        value={timeLocalDraft}
                        disabled={organizerTimingDisabled}
                        onChange={(event) => setTimeLocalDraft(event.currentTarget.value)}
                        onBlur={flushOrganizerTimeLocal}
                        className={[
                          "h-9 w-full rounded-lg border border-foreground/[0.08] bg-white/55 px-3 text-[13px] leading-none text-foreground/90",
                          "outline-none transition-[background-color,border-color] focus:border-foreground/[0.18] focus:bg-white/80",
                          "focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0",
                          "disabled:cursor-not-allowed disabled:opacity-50",
                          "dark:bg-white/[0.04] dark:focus:bg-white/[0.08]",
                        ].join(" ")}
                      />
                    </label>
                  </div>
                  {settings.memory.organizerSchedule.frequency === "weekly" ? (
                    <label className="block space-y-1.5">
                      <span className="text-[11.5px] text-muted-foreground/90">
                        {t("settings.memoryOrganizerWeekday")}
                      </span>
                      <DrawerSelect
                        value={String(settings.memory.organizerSchedule.weekday ?? 1)}
                        disabled={organizerTimingDisabled}
                        onValueChange={(next) => updateOrganizerSchedule({ weekday: Number(next) })}
                        ariaLabel={t("settings.memoryOrganizerWeekday")}
                        options={MEMORY_ORGANIZER_WEEKDAYS.map((key, index) => ({
                          value: String(index),
                          label: t(key),
                        }))}
                      />
                    </label>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block space-y-1.5">
                      <span className="text-[11.5px] text-muted-foreground/90">
                        {t("settings.memoryOrganizerScope")}
                      </span>
                      <DrawerSelect
                        value={settings.memory.organizerScope}
                        onValueChange={(next) => {
                          const organizerScope = next as MemoryOrganizerScope;
                          setSettings((prev) => updateMemorySettings(prev, { organizerScope }));
                        }}
                        ariaLabel={t("settings.memoryOrganizerScope")}
                        options={MEMORY_ORGANIZER_SCOPES.map((item) => ({
                          value: item.value,
                          label: t(item.labelKey),
                        }))}
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11.5px] text-muted-foreground/90">
                        {t("settings.memoryOrganizerMode")}
                      </span>
                      <DrawerSelect
                        value={settings.memory.organizerMode}
                        onValueChange={(next) => {
                          const organizerMode = next as MemoryOrganizerMode;
                          setSettings((prev) => updateMemorySettings(prev, { organizerMode }));
                        }}
                        ariaLabel={t("settings.memoryOrganizerMode")}
                        options={MEMORY_ORGANIZER_MODES.map((item) => ({
                          value: item.value,
                          label: t(item.labelKey),
                        }))}
                      />
                    </label>
                  </div>
                  {settings.memory.organizerEnabled && settings.memory.organizerNextRunAt ? (
                    <div className="flex items-center gap-2 rounded-xl border border-foreground/[0.05] bg-foreground/[0.025] px-3 py-2 text-[11.5px] text-muted-foreground">
                      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
                        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/40" />
                        <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="font-medium text-foreground/75">
                        {t("settings.memoryOrganizerNextRun")}
                      </span>
                      <span className="ml-auto font-mono text-foreground/70">
                        {formatTime(settings.memory.organizerNextRunAt)}
                      </span>
                    </div>
                  ) : null}
                  {organizerFeedback ? (
                    <div className="whitespace-pre-wrap rounded-xl border border-foreground/[0.05] bg-foreground/[0.025] px-3 py-2 text-[11.5px] text-muted-foreground">
                      {organizerFeedback}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2 px-0.5 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="flex-1 border border-foreground/[0.07] bg-white/45 backdrop-blur hover:bg-white/70 dark:bg-white/[0.035] dark:hover:bg-white/[0.07]"
                  onClick={() => setHistoryOpen(true)}
                >
                  <History className="h-3.5 w-3.5" />
                  {t("settings.memoryOrganizerHistory")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1 shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_10px_-6px_rgba(15,23,42,0.18)]"
                  disabled={!settings.memory.organizerModel || organizerSubmitting}
                  onClick={handleRunNow}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${organizerSubmitting ? "animate-spin" : ""}`}
                  />
                  {t("settings.memoryOrganizerRunNow")}
                </Button>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-destructive/75">
                <AlertTriangle className="h-3 w-3" />
                {t("settings.memorySettingsDangerZone")}
              </div>
              <div className="rounded-2xl border border-destructive/15 bg-destructive/[0.025] p-4 backdrop-blur-md">
                <div className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {t("settings.memorySettingsWipeDescription")}
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => setDrawerWipeConfirmOpen(true)}
                  disabled={saving}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("settings.memoryWipeAll")}
                </Button>
              </div>
            </section>
          </div>
        </div>
      </aside>
      {historyOpen ? (
        <MemoryOrganizerHistoryModal
          t={t}
          workdir={workdir}
          onClose={() => setHistoryOpen(false)}
          onMemoryChanged={onMemoryChanged}
        />
      ) : null}
      {drawerWipeConfirmOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-drawer-wipe-confirm-title"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerWipeConfirmOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border bg-background shadow-2xl">
            <div className="flex items-start gap-3 border-b px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div className="min-w-0 flex-1">
                <div id="memory-drawer-wipe-confirm-title" className="text-sm font-semibold">
                  {t("settings.memoryWipeConfirmTitle")}
                </div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.memoryWipeConfirmDescription")}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrawerWipeConfirmOpen(false)}
                disabled={saving}
              >
                {t("settings.memoryCancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setDrawerWipeConfirmOpen(false);
                  void onRequestWipe();
                }}
                disabled={saving}
              >
                {t("settings.memoryWipeAll")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

export function MemoryPanel(props: {
  workdir?: string;
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}) {
  const { t } = useLocale();
  const workdir = props.workdir?.trim() || undefined;
  const [tab, setTab] = useState<MemoryTab>("global");
  const [entries, setEntries] = useState<MemoryMeta[]>([]);
  const [quota, setQuota] = useState<MemoryQuota | null>(null);
  const [selected, setSelected] = useState<MemoryReadResponse | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MemoryMeta | null>(null);
  const [pathsInfo, setPathsInfo] = useState<MemoryPathsInfo | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [organizerWatchRunId, setOrganizerWatchRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    slug: "",
    scope: "global" as "global" | "project",
    memoryType: "user" as MemoryType,
    description: "",
    body: "",
  });
  const [editDraft, setEditDraft] = useState({
    description: "",
    body: "",
    appendBody: "",
  });

  const modelOptions = useMemo(() => buildMemoryModelOptions(props.settings), [props.settings]);

  const globalEntries = useMemo(() => {
    return entries
      .filter((entry) => entry.scope === "global" && entry.memoryType !== "daily")
      .filter((entry) => matchesFilter(entry, filter));
  }, [entries, filter]);

  const dailyEntries = useMemo(() => {
    return entries
      .filter((entry) => entry.memoryType === "daily")
      .filter((entry) => matchesFilter(entry, filter));
  }, [entries, filter, tab]);

  const projectGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; latestUpdatedAt: number; entries: MemoryMeta[] }
    >();
    for (const entry of entries) {
      if (entry.scope !== "project" || entry.memoryType === "daily") continue;
      if (!matchesFilter(entry, filter)) continue;
      const key = entry.workdirHash || entry.workdirPath || "unknown";
      const label = projectLabel(entry, t);
      const group = groups.get(key) ?? {
        key,
        label,
        latestUpdatedAt: 0,
        entries: [],
      };
      group.latestUpdatedAt = Math.max(group.latestUpdatedAt, entry.updatedAt);
      group.entries.push(entry);
      groups.set(key, group);
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        entries: group.entries.sort((a, b) =>
          b.updatedAt === a.updatedAt ? a.slug.localeCompare(b.slug) : b.updatedAt - a.updatedAt,
        ),
      }))
      .sort((a, b) =>
        b.latestUpdatedAt === a.latestUpdatedAt
          ? a.label.localeCompare(b.label)
          : b.latestUpdatedAt - a.latestUpdatedAt,
      );
  }, [entries, filter, t]);

  const projectEntryCount = entries.filter(
    (entry) => entry.scope === "project" && entry.memoryType !== "daily",
  ).length;
  const globalEntryCount = entries.filter(
    (entry) => entry.scope === "global" && entry.memoryType !== "daily",
  ).length;
  const dailyEntryCount = entries.filter((entry) => entry.memoryType === "daily").length;
  const unreviewedCount = entries.filter((entry) => entry.unreviewed).length;
  const quotaItems = useMemo(
    () => fallbackScopeQuotas(entries, quota, Boolean(workdir)),
    [entries, quota, workdir],
  );
  const quotaStatus = strongestQuotaLevel(quotaItems);

  async function reload(keepEntry?: string | null) {
    setLoading(true);
    setError(null);
    try {
      const [list, info] = await Promise.all([
        memoryList({ workdir, includeAllProjects: true, includeDaily: true, limit: 1000 }),
        memoryPathsInfo(),
      ]);
      setEntries(list.entries);
      setQuota(list.quota);
      setPathsInfo(info);
      const keepKey =
        keepEntry === undefined ? (selectedEntry ? entryKey(selectedEntry) : null) : keepEntry;
      if (keepKey) {
        const found =
          list.entries.find((entry) => entryKey(entry) === keepKey) ??
          list.entries.find((entry) => entry.slug === keepKey);
        if (found) {
          await openEntry(found);
        } else {
          setSelected(null);
          setSelectedEntry(null);
        }
      }
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setLoading(false);
    }
  }

  async function openEntry(entry: MemoryMeta) {
    setError(null);
    try {
      const read = await memoryRead({
        slug: entry.slug,
        scope: entry.scope,
        workdir: selectedEntryWorkdir(entry, workdir),
        workdirHash: entry.scope === "project" ? entry.workdirHash : undefined,
      });
      setSelected(read);
      setSelectedEntry(entry);
      setEditDraft({
        description: read.description,
        body: read.body,
        appendBody: "",
      });
    } catch (err) {
      setError(formatMemoryError(err));
    }
  }

  async function createEntry() {
    setSaving(true);
    setError(null);
    try {
      if (draft.scope === "project" && !workdir) {
        throw new Error(t("settings.memoryProjectRequiresWorkdir"));
      }
      const result = await memoryWrite({
        slug: draft.slug,
        scope: draft.scope,
        workdir,
        memoryType: draft.memoryType,
        description: draft.description,
        body: draft.body,
        actor: "user",
      });
      setShowCreate(false);
      setDraft({
        slug: "",
        scope: "global",
        memoryType: "user",
        description: "",
        body: "",
      });
      await reload(result.slug);
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveSelected() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const isDaily = selected.memoryType === "daily";
      const result = await memoryUpdate({
        slug: selected.slug,
        scope: selected.scope,
        workdir: selectedEntryWorkdir(selectedEntry, workdir),
        workdirHash: selectedEntry?.scope === "project" ? selectedEntry.workdirHash : undefined,
        description: isDaily ? undefined : editDraft.description,
        body: isDaily ? editDraft.appendBody : editDraft.body,
        mode: isDaily ? "append" : "replace",
        actor: "user",
      });
      setEditDraft((prev) => ({ ...prev, appendBody: "" }));
      await reload(selectedEntry ? entryKey(selectedEntry) : result.slug);
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setSaving(false);
    }
  }

  async function acceptSelected() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await memoryAccept({
        slug: selected.slug,
        scope: selected.scope,
        workdir: selectedEntryWorkdir(selectedEntry, workdir),
        workdirHash: selectedEntry?.scope === "project" ? selectedEntry.workdirHash : undefined,
      });
      await reload(selectedEntry ? entryKey(selectedEntry) : selected.slug);
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await memoryDelete({
        slug: selected.slug,
        scope: selected.scope,
        workdir: selectedEntryWorkdir(selectedEntry, workdir),
        workdirHash: selectedEntry?.scope === "project" ? selectedEntry.workdirHash : undefined,
        actor: "user",
      });
      setSelected(null);
      setSelectedEntry(null);
      await reload();
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setSaving(false);
    }
  }

  async function wipeAll() {
    if (saving) return;
    setWipeConfirmOpen(false);
    setSaving(true);
    setError(null);
    try {
      const info = await memoryWipeAll();
      setPathsInfo(info);
      setEntries([]);
      setQuota((prev) =>
        prev
          ? {
              ...prev,
              used: 0,
              scopeQuotas: prev.scopeQuotas?.map((item) => ({ ...item, used: 0 })),
            }
          : prev,
      );
      setSelected(null);
      setSelectedEntry(null);
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!organizerWatchRunId) return;
    const watchedRunId = organizerWatchRunId;
    let cancelled = false;

    async function pollRun() {
      try {
        const run = await memoryOrganizeRunRead({ runId: watchedRunId });
        if (cancelled || (run && isOrganizerRunActive(run))) return;
        setOrganizerWatchRunId(null);
        await reload();
      } catch (err) {
        if (cancelled) return;
        setOrganizerWatchRunId(null);
        setError(formatMemoryError(err));
      }
    }

    const interval = window.setInterval(() => void pollRun(), MEMORY_ORGANIZER_RUN_REFRESH_POLL_MS);
    void pollRun();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizerWatchRunId]);

  useEffect(() => {
    setSelected(null);
    setSelectedEntry(null);
    void reload(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workdir]);

  const activeEntryKey = selectedEntry ? entryKey(selectedEntry) : null;

  function renderEntryButton(entry: MemoryMeta, nested = false) {
    const active = activeEntryKey === entryKey(entry);
    return (
      <button
        key={entryKey(entry)}
        type="button"
        onClick={() => openEntry(entry)}
        className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
          nested ? "ml-3 w-[calc(100%-0.75rem)]" : ""
        } ${
          active
            ? "border-primary/50 bg-primary/5 shadow-xs"
            : entry.unreviewed
              ? "border-amber-500/20 bg-amber-500/[0.05] hover:bg-amber-500/[0.08]"
              : "border-border/50 bg-background/70 hover:bg-muted/35"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-xs font-semibold">{entryTitle(entry)}</div>
          <div className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {memoryTypeLabel(entry.memoryType, t)}
          </div>
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">
          id: {entry.slug}
        </div>
      </button>
    );
  }

  function renderFlatEntries(items: MemoryMeta[], emptyKey: string) {
    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
          {t(emptyKey)}
        </div>
      );
    }
    return <div className="space-y-1.5">{items.map((entry) => renderEntryButton(entry))}</div>;
  }

  return (
    <>
      <div className="settings-memory-panel flex min-h-0 flex-1 flex-col gap-4">
        <div className="settings-memory-summary-card shrink-0 rounded-xl border border-border/60 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Brain className="h-4 w-4 text-muted-foreground" />
                {t("settings.memoryTitle")}
              </div>
              <div className="break-all text-xs text-muted-foreground">
                {pathsInfo?.root ?? "~/.liveagent/memory"}
              </div>
            </div>
            <div className="settings-memory-summary-actions flex flex-wrap items-center gap-2">
              {quotaItems.map((item) => {
                const level = quotaLevel(item);
                const label =
                  item.scope === "global"
                    ? t("settings.memoryQuotaGlobal")
                    : t("settings.memoryQuotaProject");
                return (
                  <div
                    key={`${item.scope}:${item.workdirHash}`}
                    className={`rounded-md border px-2.5 py-1.5 text-xs ${quotaPillClass(level)}`}
                  >
                    {label} {item.used} / {item.limit}
                  </div>
                );
              })}
              <div
                className={`rounded-md border px-2.5 py-1.5 text-xs ${quotaStatusClass(quotaStatus)}`}
              >
                {t(quotaStatusLabelKey(quotaStatus))}
              </div>
              <Button variant="outline" size="sm" onClick={() => reload()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {t("settings.memoryRefresh")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title={t("settings.memoryOpenSettings")}
                aria-label={t("settings.memoryOpenSettings")}
                onClick={() => setSettingsDrawerOpen(true)}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {unreviewedCount > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {unreviewedCount} {t("settings.memoryAwaitingReview")}
            </div>
          ) : null}
          {pathsInfo?.isInCloud ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("settings.memoryCloudWarningPrefix")}{" "}
              {pathsInfo.cloudProvider ?? t("settings.memoryCloudSyncFolder")}
            </div>
          ) : null}
          {quotaStatus === "full" || quotaStatus === "danger" ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t(
                quotaStatus === "full"
                  ? "settings.memoryQuotaFullMessage"
                  : "settings.memoryQuotaNearLimitMessage",
              )}
            </div>
          ) : quotaStatus === "warning" ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("settings.memoryQuotaWarningMessage")}
            </div>
          ) : null}
          {error ? (
            <div className="mt-3 whitespace-pre-wrap rounded-lg border border-destructive/20 bg-destructive/[0.05] px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <div className="settings-memory-layout grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <section className="settings-memory-list-section flex min-h-0 flex-col rounded-xl border border-border/60 bg-card">
            <div className="shrink-0 space-y-3 border-b border-border/40 p-3">
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => setTab("global")}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${tab === "global" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                >
                  <Globe2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t("settings.memoryCategoryGlobal")}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {globalEntryCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("project")}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${tab === "project" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t("settings.memoryCategoryProject")}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {projectEntryCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("journal")}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${tab === "journal" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t("settings.memoryCategoryJournal")}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {dailyEntryCount}
                  </span>
                </button>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="pl-8 text-xs"
                    placeholder={t("settings.memorySearchPlaceholder")}
                  />
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  title={t("settings.memoryNew")}
                  onClick={() => setShowCreate((value) => !value)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="settings-memory-entry-list min-h-0 flex-1 overflow-auto p-2">
              {tab === "global" ? (
                renderFlatEntries(globalEntries, "settings.memoryNoGlobalEntries")
              ) : tab === "journal" ? (
                renderFlatEntries(dailyEntries, "settings.memoryNoJournalEntries")
              ) : projectGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
                  {t("settings.memoryNoProjectEntries")}
                </div>
              ) : (
                <div className="space-y-2">
                  {projectGroups.map((group) => (
                    <details
                      key={group.key}
                      className="group rounded-lg border border-border/50 bg-muted/15"
                      open
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-left text-xs [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-0 -rotate-90" />
                        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium" title={group.label}>
                          {group.label}
                        </span>
                        <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {group.entries.length}
                        </span>
                      </summary>
                      <div className="space-y-1.5 border-t border-border/40 px-2 py-2">
                        {group.entries.map((entry) => renderEntryButton(entry, true))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="settings-memory-detail-section flex min-h-0 flex-col rounded-xl border border-border/60 bg-card">
            {showCreate ? (
              <div className="shrink-0 border-b border-border/40 p-4">
                <div className="mb-3 text-sm font-semibold">{t("settings.memoryNew")}</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    value={draft.slug}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, slug: event.target.value }))
                    }
                    placeholder={t("settings.memorySlugPlaceholder")}
                  />
                  <select
                    value={draft.memoryType}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        memoryType: event.target.value as MemoryType,
                      }))
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {MEMORY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {memoryTypeLabel(type, t)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={draft.scope}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        scope: event.target.value as "global" | "project",
                      }))
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="global">{t("settings.memoryScopeGlobal")}</option>
                    <option value="project">{t("settings.memoryScopeProject")}</option>
                  </select>
                  <Input
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, description: event.target.value }))
                    }
                    placeholder={t("settings.memoryDescriptionPlaceholder")}
                  />
                </div>
                <textarea
                  value={draft.body}
                  onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
                  className="mt-3 min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder={t("settings.memoryBodyPlaceholder")}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
                    {t("settings.memoryCancel")}
                  </Button>
                  <Button size="sm" onClick={createEntry} disabled={saving}>
                    {t("settings.memorySave")}
                  </Button>
                </div>
              </div>
            ) : null}

            {selected ? (
              <>
                <div className="shrink-0 border-b border-border/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-semibold">
                          {selectedTitle(selected)}
                        </div>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {memoryScopeLabel(selected.scope, t)}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {memoryTypeLabel(selected.memoryType, t)}
                        </span>
                        {selected.meta.unreviewed ? (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                            {t("settings.memoryUnreviewed")}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("settings.memoryUpdated")} {formatTime(selected.meta.updatedAt)}
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">
                        id: {selected.slug}
                      </div>
                      {selectedEntry?.scope === "project" ? (
                        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70">
                          {selectedEntry.workdirPath || selectedEntry.workdirHash}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {selected.meta.unreviewed && selected.memoryType !== "daily" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={acceptSelected}
                          disabled={saving}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t("settings.memoryAccept")}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={deleteSelected}
                        disabled={saving}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("settings.memoryDelete")}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="settings-memory-detail-body min-h-0 flex-1 overflow-auto p-4">
                  {selected.memoryType === "daily" ? (
                    <div className="space-y-3">
                      <textarea
                        value={editDraft.appendBody}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, appendBody: event.target.value }))
                        }
                        className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder={t("settings.memoryAppendBlockPlaceholder")}
                      />
                      <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                          {selected.body || t("settings.memoryEmptyBody")}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Input
                        value={editDraft.description}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, description: event.target.value }))
                        }
                        placeholder={t("settings.memoryDescriptionPlaceholder")}
                      />
                      <textarea
                        value={editDraft.body}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, body: event.target.value }))
                        }
                        className="min-h-[360px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                      />
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t border-border/40 p-4">
                  <div className="flex justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWipeConfirmOpen(true)}
                        disabled={saving}
                      >
                        {t("settings.memoryWipeAll")}
                      </Button>
                    </div>
                    <Button size="sm" onClick={saveSelected} disabled={saving}>
                      {t("settings.memorySave")}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {t("settings.memorySelectEntry")}
              </div>
            )}
          </section>
        </div>
      </div>

      {settingsDrawerOpen ? (
        <MemorySettingsDrawer
          modelOptions={modelOptions}
          settings={props.settings}
          setSettings={props.setSettings}
          workdir={workdir}
          saving={saving}
          t={t}
          onClose={() => setSettingsDrawerOpen(false)}
          onRequestWipe={wipeAll}
          onOrganizerRunQueued={(runId) => setOrganizerWatchRunId(runId)}
          onMemoryChanged={() => {
            void reload();
          }}
        />
      ) : null}

      {wipeConfirmOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="memory-wipe-confirm-title"
            >
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setWipeConfirmOpen(false)}
              />
              <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border bg-background shadow-2xl">
                <div className="flex items-start gap-3 border-b px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div id="memory-wipe-confirm-title" className="text-sm font-semibold">
                      {t("settings.memoryWipeConfirmTitle")}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t("settings.memoryWipeConfirmDescription")}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 px-5 py-4">
                  <Button variant="outline" size="sm" onClick={() => setWipeConfirmOpen(false)}>
                    {t("settings.memoryCancel")}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={wipeAll} disabled={saving}>
                    {t("settings.memoryWipeAll")}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
