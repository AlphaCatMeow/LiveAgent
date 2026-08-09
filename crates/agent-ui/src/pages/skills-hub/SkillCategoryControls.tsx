import {
  Activity,
  BookOpen,
  Brain,
  Globe,
  House,
  Layers,
  ListChecks,
  MessageCircle,
  Package,
  Palette,
  Plug,
  Shield,
  Wallet,
  Wrench,
  Zap,
} from "@liveagent/app/components/icons";
import { ToggleGroup, ToggleGroupItem } from "@liveagent/ui/components/ui/toggle-group";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import {
  CLAWHUB_CATEGORY_SLUGS,
  type ClawHubCategorySlug,
  classifyClawHubSkill,
} from "@liveagent/ui/lib/skills/clawHubCategories";
import type { SkillSummary } from "@liveagent/ui/lib/skills/index";

export type StoreCategoryValue = "all" | ClawHubCategorySlug;

// 图标与 ClawHub 官网分类侧边栏一一对应（layers/plug/zap/globe/wrench/…）。
export const STORE_CATEGORY_ICONS: Record<StoreCategoryValue, typeof Layers> = {
  all: Layers,
  integrations: Plug,
  automation: Zap,
  research: Globe,
  development: Wrench,
  productivity: ListChecks,
  communication: MessageCircle,
  creative: Palette,
  knowledge: BookOpen,
  agents: Brain,
  operations: Activity,
  security: Shield,
  finance: Wallet,
  lifestyle: House,
  other: Package,
};

const STORE_CATEGORY_OPTIONS: readonly StoreCategoryValue[] = ["all", ...CLAWHUB_CATEGORY_SLUGS];

function storeCategoryLabelKey(value: StoreCategoryValue): string {
  return `settings.skillsStoreCategory${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

// 已安装技能没有 ClawHub 的 topics 字段，用名称+描述做启发式分类。
export function classifyInstalledSkill(skill: SkillSummary): ClawHubCategorySlug[] {
  return classifyClawHubSkill({
    slug: skill.name,
    displayName: skill.name,
    summary: skill.description,
    topics: [],
  });
}

export function StoreCategoryChips(props: {
  value: StoreCategoryValue;
  counts: ReadonlyMap<StoreCategoryValue, number>;
  onChange: (value: StoreCategoryValue) => void;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <div className={cn("hub-panel-enter", props.className)}>
      <ToggleGroup
        value={[props.value]}
        onValueChange={(values) => {
          const nextValue = values[0] as StoreCategoryValue | undefined;
          if (nextValue) props.onChange(nextValue);
        }}
        aria-label={t("settings.skillsStoreCategoryAll")}
        className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-muted/35 p-1.5 shadow-xs"
      >
        {STORE_CATEGORY_OPTIONS.map((value) => {
          const CategoryIcon = STORE_CATEGORY_ICONS[value];
          const count = props.counts.get(value) ?? 0;
          return (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={`${t(storeCategoryLabelKey(value))}: ${count}`}
              className="group h-8 shrink-0 gap-1.5 rounded-lg border border-transparent px-2.5 text-[11.5px] text-foreground/70 hover:bg-background/70 hover:text-foreground data-[pressed]:border-border/70 data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-xs"
            >
              <CategoryIcon className="h-3.5 w-3.5" />
              <span>{t(storeCategoryLabelKey(value))}</span>
              <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-background px-1 text-[10px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border/50 group-data-[pressed]:text-foreground">
                {count}
              </span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

export function InstalledSkillCategoryChip(props: {
  category: ClawHubCategorySlug;
  onSelect: (category: ClawHubCategorySlug) => void;
}) {
  const { t } = useLocale();
  const CategoryIcon = STORE_CATEGORY_ICONS[props.category];
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect(props.category);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-foreground/80 ring-1 ring-border/60 transition-colors hover:bg-muted hover:text-foreground"
    >
      <CategoryIcon className="h-2.5 w-2.5" />
      <span>{t(storeCategoryLabelKey(props.category))}</span>
    </button>
  );
}

export function SkillCategoryBadges(props: {
  categories: ClawHubCategorySlug[];
  topics?: string[];
  onSelect: (category: ClawHubCategorySlug) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-1">
      {props.categories.map((category) => {
        const BadgeIcon = STORE_CATEGORY_ICONS[category];
        return (
          <button
            key={category}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              props.onSelect(category);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-foreground/80 ring-1 ring-border/60 transition-colors hover:bg-muted hover:text-foreground"
          >
            <BadgeIcon className="h-2.5 w-2.5" />
            <span>{t(storeCategoryLabelKey(category))}</span>
          </button>
        );
      })}
      {(props.topics ?? []).slice(0, 3).map((topic) => (
        <span
          key={topic}
          className="shrink-0 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {topic}
        </span>
      ))}
    </div>
  );
}
