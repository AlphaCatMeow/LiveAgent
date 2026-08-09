import {
  type Activity,
  BookOpen,
  Bot,
  Brain,
  Cable,
  Check,
  CircleHelp,
  Cloud,
  Cpu,
  FileText,
  Folder,
  GitBranch,
  Globe,
  ImageIcon,
  Key,
  LayoutGrid,
  Lightbulb,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  MessageSquare,
  Plug,
  Radio,
  RefreshCw,
  ScanText,
  ScrollText,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  SkillIcon,
  Sparkles,
  Terminal,
  Timer,
  Trash2,
  Waypoints,
  Wifi,
  Wrench,
  Zap,
} from "@liveagent/app/components/icons";
import { ConfirmDeletePopover } from "@liveagent/ui/components/ui/confirm-action-popover";
import { Switch } from "@liveagent/ui/components/ui/switch";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import type { ClawHubCategorySlug } from "@liveagent/ui/lib/skills/clawHubCategories";
import type { SkillSummary } from "@liveagent/ui/lib/skills/index";
import {
  getInstalledSkillCardIdentity,
  type InstalledSkillCardIconName,
} from "@liveagent/ui/lib/skills/skillCardIdentity";
import {
  getInstalledSkillCardSource,
  getRelativeInstalledAt,
} from "@liveagent/ui/lib/skills/skillCardMetadata";
import { getSkillTriggerHint } from "@liveagent/ui/lib/skills/skillTriggerHint";
import { memo, useMemo } from "react";
import { InstalledSkillCategoryChip } from "./SkillCategoryControls";

const INSTALLED_SKILL_ICON_TONES = [
  "border-sky-500/30 bg-sky-500/12 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/15 dark:text-sky-200",
  "border-indigo-500/30 bg-indigo-500/12 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/15 dark:text-indigo-200",
  "border-violet-500/30 bg-violet-500/12 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/15 dark:text-violet-200",
  "border-fuchsia-500/30 bg-fuchsia-500/12 text-fuchsia-700 dark:border-fuchsia-400/30 dark:bg-fuchsia-400/15 dark:text-fuchsia-200",
  "border-rose-500/30 bg-rose-500/12 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/15 dark:text-rose-200",
  "border-orange-500/30 bg-orange-500/12 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/15 dark:text-orange-200",
  "border-amber-500/30 bg-amber-500/12 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-200",
  "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/15 dark:text-emerald-200",
  "border-cyan-500/30 bg-cyan-500/12 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/15 dark:text-cyan-200",
] as const;

const INSTALLED_SKILL_CARD_ICONS: Record<InstalledSkillCardIconName, typeof Activity> = {
  bookOpen: BookOpen,
  bot: Bot,
  brain: Brain,
  cable: Cable,
  circleHelp: CircleHelp,
  cloud: Cloud,
  cpu: Cpu,
  fileText: FileText,
  folder: Folder,
  gitBranch: GitBranch,
  globe: Globe,
  imageIcon: ImageIcon,
  key: Key,
  layoutGrid: LayoutGrid,
  lightbulb: Lightbulb,
  link2: Link2,
  listChecks: ListChecks,
  lock: Lock,
  messageSquare: MessageSquare,
  plug: Plug,
  radio: Radio,
  refreshCw: RefreshCw,
  scanText: ScanText,
  scrollText: ScrollText,
  search: Search,
  send: Send,
  server: Server,
  settings: Settings,
  shield: Shield,
  sparkles: Sparkles,
  terminal: Terminal,
  timer: Timer,
  waypoints: Waypoints,
  wifi: Wifi,
  wrench: Wrench,
  zap: Zap,
};

let cachedFullDateFormat: Intl.DateTimeFormat | null = null;

function getFullDateFormat() {
  cachedFullDateFormat ??= new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return cachedFullDateFormat;
}

function formatInstalledSkillMetadata(skill: SkillSummary, t: (key: string) => string): string {
  const source = getInstalledSkillCardSource(skill);
  const sourceLabel =
    source === "built-in"
      ? t("settings.skillsInstalledCardSourceBuiltIn")
      : source === "clawhub"
        ? t("settings.skillsInstalledCardSourceClawHub")
        : t("settings.skillsInstalledCardSourceLocal");
  if (source === "built-in") return sourceLabel;

  const relativeInstalledAt = getRelativeInstalledAt(skill.installedAt);
  if (!relativeInstalledAt) return sourceLabel;
  if (relativeInstalledAt.kind === "today") {
    return `${sourceLabel} · ${t("settings.skillsInstalledCardInstalledToday")}`;
  }
  if (relativeInstalledAt.kind === "days-ago") {
    return `${sourceLabel} · ${t("settings.skillsInstalledCardInstalledDaysAgo").replace(
      "{count}",
      String(relativeInstalledAt.days),
    )}`;
  }

  const date = getFullDateFormat().format(new Date(relativeInstalledAt.timestamp));
  return `${sourceLabel} · ${date}`;
}

type InstalledSkillCardProps = {
  skill: SkillSummary;
  flipKey: string;
  primaryCategory: ClawHubCategorySlug;
  alwaysEnabled: boolean;
  checked: boolean;
  bulkMode: boolean;
  bulkSelected: boolean;
  deleting: boolean;
  deleteDisabled: boolean;
  onToggle: (name: string, on: boolean) => void;
  onEnterBulkMode: (name: string) => void;
  onToggleBulkSelection: (name: string) => void;
  onBulkCardClick: (name: string, shiftKey: boolean) => void;
  onOpenPreview: (skill: SkillSummary) => void;
  onDelete: (skill: SkillSummary) => void;
  onSelectCategory: (category: ClawHubCategorySlug) => void;
};

// 安装卡片抽成 memo 组件：props 只传标量与稳定引用（布尔代替 Set 成员判断、
// primaryCategory 代替数组、latest-ref 回调），父组件的无关状态更新（搜索、
// store 轮询、抽屉开关等）不再重渲整片网格；triggerHint/identity/metadata
// 等派生计算也随之只在自身输入变化时重算。技能数量大时这是主要的卡顿来源。
export const InstalledSkillCard = memo(function InstalledSkillCard(props: InstalledSkillCardProps) {
  const {
    skill,
    flipKey,
    primaryCategory,
    alwaysEnabled,
    checked,
    bulkMode,
    bulkSelected,
    deleting,
    deleteDisabled,
    onToggle,
    onEnterBulkMode,
    onToggleBulkSelection,
    onBulkCardClick,
    onOpenPreview,
    onDelete,
    onSelectCategory,
  } = props;
  const { t } = useLocale();
  const triggerHint = useMemo(() => getSkillTriggerHint(skill.description), [skill.description]);
  const cardIdentity = useMemo(
    () => (alwaysEnabled ? null : getInstalledSkillCardIdentity(skill.name, primaryCategory)),
    [alwaysEnabled, primaryCategory, skill.name],
  );
  const CardIcon = alwaysEnabled
    ? SkillIcon
    : INSTALLED_SKILL_CARD_ICONS[cardIdentity?.iconName ?? "circleHelp"];
  const iconTone = cardIdentity ? INSTALLED_SKILL_ICON_TONES[cardIdentity.colorIndex] : null;
  const metadataSource = getInstalledSkillCardSource(skill);
  const MetadataIcon =
    metadataSource === "built-in" ? Lock : metadataSource === "clawhub" ? Cloud : Folder;
  const metadataLabel = useMemo(() => formatInstalledSkillMetadata(skill, t), [skill, t]);
  const card = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all",
            alwaysEnabled
              ? "border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
              : cn(iconTone, checked ? "shadow-[0_1px_0_rgba(255,255,255,0.45)_inset]" : null),
          )}
        >
          <CardIcon className="h-5 w-5" />
        </div>

        {alwaysEnabled && !bulkMode ? (
          <div
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-foreground/80 ring-1 ring-border/60"
            title={t("settings.skillsAlwaysOn")}
          >
            <Lock className="h-2.5 w-2.5" />
            <span>{t("settings.skillsAlwaysOn")}</span>
          </div>
        ) : bulkMode ? (
          alwaysEnabled ? (
            <div
              className="flex shrink-0 items-center"
              title={t("settings.skillsBulkAlwaysOnDisabled")}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none flex h-5 w-5 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground/50 opacity-60"
              >
                <Lock className="h-2.5 w-2.5" />
              </span>
            </div>
          ) : (
            <div className="flex shrink-0 items-center">
              <label
                className="relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center"
                title={t("settings.skillsHubBulkSelectLabel")}
              >
                <input
                  type="checkbox"
                  checked={bulkSelected}
                  aria-label={`${t("settings.skillsHubBulkSelectLabel")}: ${skill.name}`}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    event.stopPropagation();
                    onToggleBulkSelection(skill.name);
                  }}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none flex h-5 w-5 items-center justify-center rounded-full border transition-all",
                    bulkSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background group-hover:border-foreground/40",
                  )}
                >
                  {bulkSelected ? <Check className="h-3 w-3" /> : null}
                </span>
              </label>
            </div>
          )
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label={`${t("settings.skillsHubBulkSelectLabel")}: ${skill.name}`}
              title={t("settings.skillsHubBulkSelect")}
              onClick={(event) => {
                event.stopPropagation();
                onEnterBulkMode(skill.name);
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className={cn(
                // Google Photos-style bulk entry: hover-faint, touch semi-visible.
                "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground shadow-sm transition-all hover:border-primary/50 hover:text-foreground",
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-70",
              )}
            >
              <span className="h-2 w-2 rounded-full border border-current opacity-40" />
            </button>
            <Switch
              tone="success"
              checked={checked}
              aria-label={`${t("skills.select")}: ${skill.name}`}
              title={
                checked ? t("settings.skillsHubToggleDisable") : t("settings.skillsHubToggleEnable")
              }
              onCheckedChange={(nextChecked) => onToggle(skill.name, nextChecked)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        )}
      </div>

      <div className="mt-2.5 min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="truncate text-[13px] font-semibold leading-tight text-foreground">
            {skill.name}
          </div>
          {checked ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/25 dark:bg-emerald-400/12 dark:text-emerald-300 dark:ring-emerald-400/25">
              {t("settings.skillsHubEnabledBadge")}
            </span>
          ) : null}
        </div>
        {triggerHint ? (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] font-medium leading-[1.35] text-primary/90 dark:text-primary">
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="shrink-0">{t("settings.skillsInstalledCardTrigger")}</span>
            <span className="truncate">{triggerHint}</span>
          </p>
        ) : null}
        {skill.description ? (
          <p
            className={cn(
              "mt-1 text-[11.5px] leading-[1.4] text-muted-foreground",
              triggerHint ? "line-clamp-1" : "line-clamp-2",
            )}
          >
            {skill.description}
          </p>
        ) : null}
        {!alwaysEnabled ? (
          <div className="mt-2">
            <InstalledSkillCategoryChip category={primaryCategory} onSelect={onSelectCategory} />
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 flex min-h-8 items-center gap-1 border-t border-border/60 pt-2 text-[10.5px] text-muted-foreground">
        <MetadataIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{metadataLabel}</span>
        {!alwaysEnabled && !bulkMode ? (
          <div className="ml-auto shrink-0">
            <ConfirmDeletePopover name={skill.name} onConfirm={() => onDelete(skill)}>
              {(open) => (
                <button
                  type="button"
                  disabled={deleteDisabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    open();
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md border border-border/35 bg-background/65 text-muted-foreground transition-all",
                    "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
                    "disabled:cursor-not-allowed",
                    // Hover-revealed on pointer devices; keyboard focus and
                    // touch (no hover — webui mobile) keep it reachable.
                    deleting
                      ? "pointer-events-auto opacity-100"
                      : cn(
                          "pointer-events-none opacity-0 group-hover:pointer-events-auto focus-visible:pointer-events-auto [@media(hover:none)]:pointer-events-auto",
                          deleteDisabled
                            ? "group-hover:opacity-60 focus-visible:opacity-60 [@media(hover:none)]:opacity-60"
                            : "group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                        ),
                  )}
                  title={t("settings.skillsHubDeleteSkill")}
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </ConfirmDeletePopover>
          </div>
        ) : null}
      </div>
    </>
  );

  const key = flipKey;
  if (alwaysEnabled) {
    return (
      <button
        data-flip-key={key}
        type="button"
        aria-label={`${t("settings.skillsInstalledPreviewOpen")}: ${skill.name}`}
        onClick={() => {
          if (bulkMode) return;
          onOpenPreview(skill);
        }}
        className={cn(
          "hub-skill-card skill-card-enter group flex h-full min-h-[13rem] w-full cursor-pointer flex-col rounded-2xl border border-border/70 bg-card p-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-border hover:bg-accent/25 hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30",
          "[content-visibility:auto] [contain-intrinsic-size:auto_13rem]",
          bulkMode ? "cursor-default hover:translate-y-0" : null,
        )}
      >
        {card}
      </button>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: The card contains nested controls and cannot be a native button.
    <div
      data-flip-key={key}
      role="button"
      tabIndex={0}
      aria-label={`${t("settings.skillsInstalledPreviewOpen")}: ${skill.name}`}
      onClick={(event) => {
        if (bulkMode) {
          onBulkCardClick(skill.name, event.shiftKey);
          return;
        }
        onOpenPreview(skill);
      }}
      onMouseDown={(event) => {
        // Shift+点击做区间选择时避免浏览器拖出文本选区
        if (bulkMode && event.shiftKey) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (bulkMode && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onBulkCardClick(skill.name, event.shiftKey);
          return;
        }
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenPreview(skill);
      }}
      className={cn(
        "hub-skill-card skill-card-enter group relative flex h-full min-h-[13rem] w-full flex-col rounded-2xl border p-3.5 text-left transition-all",
        "cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30",
        "[content-visibility:auto] [contain-intrinsic-size:auto_13rem]",
        // Enabled style always visible; bulk selection overlays primary ring.
        checked
          ? "border-emerald-500/45 bg-card shadow-sm dark:border-emerald-400/40"
          : "border-border/70 bg-card shadow-xs hover:-translate-y-0.5 hover:border-border hover:bg-accent/25 hover:shadow-md",
        bulkSelected ? "ring-2 ring-primary/50 ring-offset-1 ring-offset-background" : null,
      )}
    >
      {card}
    </div>
  );
});
