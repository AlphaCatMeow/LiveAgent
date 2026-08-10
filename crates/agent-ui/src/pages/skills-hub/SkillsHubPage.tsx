import {
  AlertTriangle,
  Blend,
  BookOpen,
  Cloud,
  Download,
  ListChecks,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X,
} from "@liveagent/app/components/icons";
import {
  type AppSettings,
  removeWorkspaceResourceReferences,
  updateSkills,
} from "@liveagent/app/lib/settings";
import { GlassPanel, HubBackdrop, HubHeader } from "@liveagent/ui/components/hub/HubChrome";
import { Button } from "@liveagent/ui/components/ui/button";
import { ConfirmActionPopover } from "@liveagent/ui/components/ui/confirm-action-popover";
import { Input } from "@liveagent/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@liveagent/ui/components/ui/select";
import { Switch } from "@liveagent/ui/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@liveagent/ui/components/ui/tabs";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import {
  buildClawHubDownloadUrl,
  buildClawHubSkillKey,
  type ClawHubSkillCard,
  type ClawHubSort,
  listClawHubSkills,
  resolveClawHubSkillOwner,
  searchClawHubSkills,
} from "@liveagent/ui/lib/skills/clawHub";
import type { ClawHubCategorySlug } from "@liveagent/ui/lib/skills/clawHubCategories";
import {
  discoverSkills,
  type ExternalSkillEntry,
  type ExternalToolScan,
  getSkillInstallJobStatus,
  isAlwaysEnabledSkillName,
  isUserSelectableSkill,
  manageSkill,
  mergeAlwaysEnabledSkillNames,
  notifySkillsDiscoveryUpdated,
  readSkillText,
  type SkillInstallJobSnapshot,
  type SkillSummary,
  scanExternalSkills,
  startSkillInstallJob,
} from "@liveagent/ui/lib/skills/index";
import {
  type InstalledSkillSort,
  isInstalledSkillSort,
  sortInstalledSkillItems,
} from "@liveagent/ui/lib/skills/installedSort";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { InstalledSkillCard } from "./InstalledSkillCard";
import {
  emptyInstalledSkillPreviewState,
  INSTALLED_SKILL_PREVIEW_LINES,
  InstalledSkillPreviewDrawer,
  type InstalledSkillPreviewState,
} from "./InstalledSkillPreviewDrawer";
import {
  classifyInstalledSkill,
  StoreCategoryChips,
  type StoreCategoryValue,
} from "./SkillCategoryControls";
import { SkillsImportView } from "./SkillsImportView";
import { ScanActivityDots, SkillsContentLoadingState } from "./SkillsLoading";
import { dedupeStoreItems, SkillsStoreView, TERMINAL_INSTALL_PHASES } from "./SkillsStoreView";
import {
  type FlipMode,
  INSTALLED_SORT_STORAGE_KEY,
  readInstalledSortPreference,
  useFlipGrid,
} from "./useFlipGrid";

type SkillsHubView = "installed" | "store" | "import";

function isSkillsHubView(value: unknown): value is SkillsHubView {
  return value === "installed" || value === "store" || value === "import";
}

const STORE_PAGE_LIMIT = 24;
const EMPTY_SKILLS: SkillSummary[] = [];

const INSTALLED_SORT_OPTIONS: Array<{ value: InstalledSkillSort; labelKey: string }> = [
  { value: "name-asc", labelKey: "settings.skillsInstalledSortNameAsc" },
  { value: "name-desc", labelKey: "settings.skillsInstalledSortNameDesc" },
  { value: "installed-desc", labelKey: "settings.skillsInstalledSortNewest" },
];
function buildSkillDiscoverySignature(rootDir: string, skills: SkillSummary[]) {
  return [
    rootDir,
    ...skills
      .map((skill) =>
        [
          skill.name,
          skill.baseDir,
          skill.skillFile,
          skill.description,
          skill.builtIn ? "1" : "0",
          skill.inlineContent?.length ?? -1,
          skill.source?.registry ?? "",
          skill.source?.slug ?? "",
          skill.installedAt ?? "",
          skill.source?.version ?? "",
        ].join("\0"),
      )
      .sort(),
  ].join("\n");
}

type SkillsHubPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  initialSkills?: SkillSummary[];
  initialRootDir?: string;
  isAgentMode: boolean;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
};

export function SkillsHubPage(props: SkillsHubPageProps) {
  const {
    settings,
    setSettings,
    initialSkills,
    initialRootDir,
    isAgentMode,
    sidebarOpen,
    onOpenSidebar,
  } = props;
  const { t } = useLocale();
  const lockedByChatMode = !isAgentMode;

  const [skills, setSkills] = useState<SkillSummary[]>(initialSkills ?? []);
  const [rootDir, setRootDir] = useState(initialRootDir ?? "");
  const [hasPresentedInstalledSkills, setHasPresentedInstalledSkills] = useState(false);
  const {
    captureVisibleKey: captureInstalledFlipKey,
    gridRef: installedGridRef,
    requestFlip: requestInstalledFlip,
  } = useFlipGrid();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [installedCategory, setInstalledCategory] = useState<StoreCategoryValue>("all");
  const [installedSort, setInstalledSort] = useState<InstalledSkillSort>(
    readInstalledSortPreference,
  );
  // 批量选择模式：仅在「已安装」「本地导入」页可用。用于在大量技能中快速圈选
  // 一段连续区间（点首项、Shift+点末项）而不必逐个勾选。
  const [bulkMode, setBulkMode] = useState(false);
  // Temporary multi-select set (not persisted). Independent from enable state.
  const [bulkSelection, setBulkSelection] = useState<ReadonlySet<string>>(() => new Set());
  const bulkAnchorRef = useRef<string | null>(null);
  const [bulkUndo, setBulkUndo] = useState<{ selected: string[]; count: number } | null>(null);
  const bulkUndoTimerRef = useRef<number | null>(null);
  const [view, setView] = useState<SkillsHubView>("installed");
  const [storeQuery, setStoreQuery] = useState("");
  const [storeSort, setStoreSort] = useState<ClawHubSort>("downloads");
  const [storeItems, setStoreItems] = useState<ClawHubSkillCard[]>([]);
  const [storeCursor, setStoreCursor] = useState<string | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeLoadingMore, setStoreLoadingMore] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [installJobs, setInstallJobs] = useState<Record<string, SkillInstallJobSnapshot>>({});
  const [installingByStoreKey, setInstallingByStoreKey] = useState<Record<string, string>>({});
  const [pendingInstallKeys, setPendingInstallKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pendingInstallTokensRef = useRef(new Map<string, symbol>());
  const [deletingSkillName, setDeletingSkillName] = useState<string | null>(null);
  const [externalScans, setExternalScans] = useState<ExternalToolScan[] | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [selectedExternal, setSelectedExternal] = useState<ReadonlySet<string>>(new Set());
  const [importQuery, setImportQuery] = useState("");
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [importingExternalBaseDir, setImportingExternalBaseDir] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<
    Array<{ baseDir: string; name: string; message: string }>
  >([]);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importToast, setImportToast] = useState<string | null>(null);
  const importToastTimerRef = useRef<number | null>(null);
  const [previewInstalledSkill, setPreviewInstalledSkill] = useState<SkillSummary | null>(null);
  const [installedPreviewState, setInstalledPreviewState] = useState<InstalledSkillPreviewState>(
    () => emptyInstalledSkillPreviewState(),
  );
  const discoverySignatureRef = useRef<string | null>(null);

  // 唯一写入点：setState 与 discoverySignatureRef 必须同步更新，防止签名与状态漂移。
  // 签名未变时跳过 setState，保持 skills 数组引用稳定（下游 memo 链与 store 轮询零重渲）。
  const applyDiscovery = useCallback((nextRootDir: string, nextSkills: SkillSummary[]) => {
    const signature = buildSkillDiscoverySignature(nextRootDir, nextSkills);
    const changed = discoverySignatureRef.current !== signature;
    discoverySignatureRef.current = signature;
    if (changed) {
      setSkills(nextSkills);
      setRootDir(nextRootDir);
    }
    return changed;
  }, []);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (lockedByChatMode) {
        setSkills([]);
        setRootDir("");
        setLoadError(null);
        setLoading(false);
        discoverySignatureRef.current = buildSkillDiscoverySignature("", []);
        return;
      }
      const silent = options?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        const discovery = await discoverSkills({ force: true });
        const changed = applyDiscovery(discovery.rootDir, discovery.skills);
        if (changed) {
          notifySkillsDiscoveryUpdated();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSkills([]);
        // 失败清空列表后必须同步重置签名，否则下一次成功刷新若内容与
        // 失败前相同会被 applyDiscovery 视为“未变化”而跳过 setState。
        discoverySignatureRef.current = buildSkillDiscoverySignature("", []);
        setLoadError(msg || t("settings.skillsHubLoadFailed"));
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [applyDiscovery, lockedByChatMode, t],
  );

  useEffect(() => {
    if (initialSkills && initialSkills.length > 0) {
      setSkills(initialSkills);
      discoverySignatureRef.current = buildSkillDiscoverySignature(
        initialRootDir ?? "",
        initialSkills,
      );
    }
  }, [initialRootDir, initialSkills]);

  useEffect(() => {
    if (initialRootDir) {
      setRootDir(initialRootDir);
    }
  }, [initialRootDir]);

  useEffect(() => {
    if ((initialSkills?.length ?? 0) === 0) {
      void refresh();
    }
  }, [initialSkills?.length, refresh]);

  const selected = useMemo(
    () => new Set(mergeAlwaysEnabledSkillNames(settings.skills.selected)),
    [settings.skills.selected],
  );
  // React 19 的 initialValue 让 Hub 外壳先独立提交；大量卡片在可中断的后台
  // render 中准备，全部完成后再原子替换加载态，避免页面切换被首屏列表挂载阻塞。
  const deferredSkills = useDeferredValue(skills, EMPTY_SKILLS);
  const installedContentPending = deferredSkills !== skills;
  useEffect(() => {
    if (!installedContentPending && deferredSkills.length > 0) {
      setHasPresentedInstalledSkills(true);
    }
  }, [deferredSkills, installedContentPending]);
  const selectableSkills = useMemo(() => skills.filter(isUserSelectableSkill), [skills]);
  const selectedCount = selectableSkills.filter((skill) => selected.has(skill.name)).length;
  useEffect(() => {
    try {
      window.localStorage.setItem(INSTALLED_SORT_STORAGE_KEY, installedSort);
    } catch {
      // The preference is non-critical when storage is unavailable.
    }
  }, [installedSort]);
  const installedSkillNames = useMemo(() => new Set(skills.map((skill) => skill.name)), [skills]);
  const requestInstalledSkillFlip = useCallback(
    (mode: FlipMode, names: readonly string[], followNames: readonly string[] = names) => {
      const keys = names.map((name) => `${name}-${rootDir}`);
      const followKeys = followNames.map((name) => `${name}-${rootDir}`);
      requestInstalledFlip(mode, keys, followKeys);
    },
    [requestInstalledFlip, rootDir],
  );

  // 过滤走 deferred 值：技能多时每击键的 filter→classify→sort 链在低优先级
  // 渲染中执行，输入框本身保持即时响应（输入框与空态提示仍绑同步 filter）。
  const deferredFilter = useDeferredValue(filter);
  const textFilteredInstalled = useMemo(() => {
    const text = deferredFilter.trim().toLowerCase();
    if (!text) return deferredSkills;
    return deferredSkills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(text) || skill.description.toLowerCase().includes(text),
    );
  }, [deferredFilter, deferredSkills]);

  // 已安装技能同样按 ClawHub 分区分类，让两个页签体验一致。始终启用（内置）
  // 技能没有真正的用途归属，统一归到 other 一栏而不参与语义分类。
  const categorizedInstalled = useMemo(
    () =>
      textFilteredInstalled.map((skill) => ({
        skill,
        categories: isAlwaysEnabledSkillName(skill.name)
          ? (["other"] as ClawHubCategorySlug[])
          : classifyInstalledSkill(skill),
      })),
    [textFilteredInstalled],
  );

  const installedCategoryCounts = useMemo(() => {
    const counts = new Map<StoreCategoryValue, number>();
    counts.set("all", categorizedInstalled.length);
    for (const { categories } of categorizedInstalled) {
      for (const category of categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return counts;
  }, [categorizedInstalled]);

  const filtered = useMemo(
    () =>
      installedCategory === "all"
        ? categorizedInstalled
        : categorizedInstalled.filter(({ categories }) => categories.includes(installedCategory)),
    [categorizedInstalled, installedCategory],
  );
  const sortedFiltered = useMemo(
    () => sortInstalledSkillItems(filtered, installedSort, selected, ({ skill }) => skill),
    [filtered, installedSort, selected],
  );
  const filteredSelectableInstalledNames = useMemo(
    () =>
      sortedFiltered
        .map(({ skill }) => skill.name)
        .filter((name) => !isAlwaysEnabledSkillName(name)),
    [sortedFiltered],
  );
  useEffect(() => {
    if (view === "installed" && !lockedByChatMode) return;
    setPreviewInstalledSkill(null);
  }, [lockedByChatMode, view]);

  const rescanExternalSkills = useCallback(async () => {
    setExternalLoading(true);
    setExternalError(null);
    try {
      const scans = await scanExternalSkills();
      setExternalScans(scans);
      // 剔除本次扫描已不存在的勾选项，避免按钮计数虚高或静默空导入
      const validBaseDirs = new Set(scans.flatMap((scan) => scan.skills.map((s) => s.baseDir)));
      setSelectedExternal((prev) => {
        const next = new Set([...prev].filter((baseDir) => validBaseDirs.has(baseDir)));
        return next.size === prev.size ? prev : next;
      });
    } catch (err) {
      setExternalScans([]);
      setSelectedExternal(new Set());
      setExternalError(err instanceof Error ? err.message : String(err));
    } finally {
      setExternalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "import" || lockedByChatMode) return;
    if (externalScans !== null || externalLoading) return;
    void rescanExternalSkills();
  }, [view, lockedByChatMode, externalScans, externalLoading, rescanExternalSkills]);

  const externalSkillByBaseDir = useMemo(() => {
    const map = new Map<string, { baseDir: string; name: string }>();
    for (const scan of externalScans ?? []) {
      for (const skill of scan.skills) {
        map.set(skill.baseDir, { baseDir: skill.baseDir, name: skill.name });
      }
    }
    return map;
  }, [externalScans]);

  const isExternalSkillInstalled = useCallback(
    (baseDir: string) => {
      const skill = externalSkillByBaseDir.get(baseDir);
      return skill ? installedSkillNames.has(skill.name) : false;
    },
    [externalSkillByBaseDir, installedSkillNames],
  );

  const showImportToast = useCallback((message: string) => {
    if (importToastTimerRef.current !== null) {
      window.clearTimeout(importToastTimerRef.current);
    }
    setImportToast(message);
    importToastTimerRef.current = window.setTimeout(() => {
      setImportToast(null);
      importToastTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (importToastTimerRef.current !== null) {
        window.clearTimeout(importToastTimerRef.current);
      }
    };
  }, []);

  const toggleExternalSkill = useCallback(
    (baseDir: string) => {
      // Already-installed skills cannot be selected for import.
      if (isExternalSkillInstalled(baseDir)) return;
      setSelectedExternal((prev) => {
        const next = new Set(prev);
        if (next.has(baseDir)) next.delete(baseDir);
        else next.add(baseDir);
        return next;
      });
    },
    [isExternalSkillInstalled],
  );

  // 批量区间勾选：已安装技能跳过，且不会进入 selectedExternal。
  const batchToggleExternalSkills = useCallback(
    (baseDirs: string[], on: boolean) => {
      setSelectedExternal((prev) => {
        const next = new Set(prev);
        for (const baseDir of baseDirs) {
          if (isExternalSkillInstalled(baseDir)) {
            next.delete(baseDir);
            continue;
          }
          if (on) next.add(baseDir);
          else next.delete(baseDir);
        }
        return next;
      });
    },
    [isExternalSkillInstalled],
  );

  const importSelectedExternalSkills = useCallback(
    async (skill?: ExternalSkillEntry) => {
      if (importProgress) return;
      const selectedSkills = skill
        ? [skill]
        : (externalScans ?? [])
            .flatMap((scan) => scan.skills)
            .filter((item) => selectedExternal.has(item.baseDir));
      const alreadyInstalledSelected = selectedSkills.filter((skill) =>
        installedSkillNames.has(skill.name),
      );
      const targets = selectedSkills.filter((skill) => !installedSkillNames.has(skill.name));
      if (targets.length === 0) {
        if (alreadyInstalledSelected.length > 0) {
          showImportToast(t("settings.skillsImportAlreadyInstalled"));
        }
        return;
      }
      setImportErrors([]);
      setImportedCount(null);
      const failures: Array<{ baseDir: string; name: string; message: string }> = [];
      for (let index = 0; index < targets.length; index += 1) {
        setImportingExternalBaseDir(targets[index].baseDir);
        setImportProgress({ done: index, total: targets.length });
        try {
          await manageSkill({
            action: "install",
            source: targets[index].baseDir,
            conflict: "backup",
          });
        } catch (err) {
          failures.push({
            baseDir: targets[index].baseDir,
            name: targets[index].name,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      setImportingExternalBaseDir(null);
      setImportProgress(null);
      setImportErrors(failures);
      setImportedCount(targets.length - failures.length);
      if (!skill) setSelectedExternal(new Set());
      await refresh({ silent: true });
    },
    [
      externalScans,
      selectedExternal,
      importProgress,
      refresh,
      installedSkillNames,
      showImportToast,
      t,
    ],
  );

  // Drop installed skills from import selection (cannot re-import).
  useEffect(() => {
    if (!externalScans) return;
    setSelectedExternal((prev) => {
      const next = new Set(
        [...prev].filter((baseDir) => {
          const skill = externalScans
            .flatMap((scan) => scan.skills)
            .find((item) => item.baseDir === baseDir);
          return skill ? !installedSkillNames.has(skill.name) : false;
        }),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [externalScans, installedSkillNames]);

  useEffect(() => {
    if (!previewInstalledSkill) {
      setInstalledPreviewState(emptyInstalledSkillPreviewState());
      return;
    }

    let cancelled = false;
    const skillFile = previewInstalledSkill.skillFile;
    setInstalledPreviewState({
      skillFile,
      content: "",
      truncated: false,
      loading: true,
      error: null,
    });

    void readSkillText({
      path: skillFile,
      offset: 0,
      length: INSTALLED_SKILL_PREVIEW_LINES,
    })
      .then((result) => {
        if (cancelled) return;
        setInstalledPreviewState({
          skillFile,
          content: result.content,
          truncated: result.truncated,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setInstalledPreviewState({
          skillFile,
          content: previewInstalledSkill.inlineContent ?? "",
          truncated: previewInstalledSkill.inlineContentTruncated ?? false,
          loading: false,
          error: msg || t("settings.skillsInstalledPreviewUnavailable"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [previewInstalledSkill, t]);

  const installedStoreState = useMemo(() => {
    const installed = new Map<string, SkillSummary>();
    const slugs = new Set<string>();
    for (const skill of skills) {
      if (skill.source?.registry !== "clawhub") continue;
      const slug = skill.source.slug?.trim();
      if (!slug) continue;
      slugs.add(slug);
      installed.set(
        buildClawHubSkillKey({ slug, ownerHandle: skill.source.ownerHandle ?? null }),
        skill,
      );
    }
    return { installed, slugs };
  }, [skills]);
  const completedInstallState = useMemo(() => {
    const keys = new Set<string>();
    const slugs = new Set<string>();
    for (const [storeKey, jobId] of Object.entries(installingByStoreKey)) {
      const job = installJobs[jobId];
      if (job?.phase === "done") {
        keys.add(storeKey);
        if (job.slug?.trim()) slugs.add(job.slug.trim());
      }
    }
    for (const job of Object.values(installJobs)) {
      if (job.phase === "done" && job.slug?.trim()) {
        slugs.add(job.slug.trim());
        keys.add(
          buildClawHubSkillKey({
            slug: job.slug.trim(),
            ownerHandle: job.ownerHandle ?? null,
          }),
        );
      }
    }
    return { keys, slugs };
  }, [installJobs, installingByStoreKey]);
  const installedStoreKeys = useMemo(() => {
    const keys = new Set(installedStoreState.installed.keys());
    for (const key of completedInstallState.keys) {
      keys.add(key);
    }
    return keys;
  }, [completedInstallState.keys, installedStoreState.installed]);
  const installedStoreSlugs = useMemo(() => {
    const slugs = new Set(installedStoreState.slugs);
    for (const slug of completedInstallState.slugs) {
      slugs.add(slug);
    }
    return slugs;
  }, [completedInstallState.slugs, installedStoreState.slugs]);

  useEffect(() => {
    if (view !== "store" || lockedByChatMode) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const query = storeQuery.trim();
      setStoreLoading(true);
      setStoreError(null);
      setStoreCursor(null);
      try {
        if (query) {
          const results = await searchClawHubSkills({ query, limit: STORE_PAGE_LIMIT });
          if (!cancelled) {
            setStoreItems(results);
            setStoreCursor(null);
          }
        } else {
          const results = await listClawHubSkills({
            sort: storeSort,
            limit: STORE_PAGE_LIMIT,
          });
          if (!cancelled) {
            setStoreItems(results.items);
            setStoreCursor(results.nextCursor);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setStoreItems([]);
          setStoreCursor(null);
          setStoreError(msg || t("settings.skillsHubStoreLoadFailed"));
        }
      } finally {
        if (!cancelled) {
          setStoreLoading(false);
        }
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lockedByChatMode, storeQuery, storeSort, t, view]);

  useEffect(() => {
    if (view !== "store" || lockedByChatMode) return;

    const syncLocalSkills = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh({ silent: true });
    };

    syncLocalSkills();
    window.addEventListener("focus", syncLocalSkills);
    document.addEventListener("visibilitychange", syncLocalSkills);
    const timer = window.setInterval(syncLocalSkills, 10_000);

    return () => {
      window.removeEventListener("focus", syncLocalSkills);
      document.removeEventListener("visibilitychange", syncLocalSkills);
      window.clearInterval(timer);
    };
  }, [lockedByChatMode, refresh, view]);

  const enableInstalledSkillsFromJob = useCallback(
    (job: SkillInstallJobSnapshot) => {
      const installedNames = (job.installed ?? [])
        .map((item) => item.name?.trim())
        .filter((name): name is string => Boolean(name) && !isAlwaysEnabledSkillName(name));
      if (installedNames.length === 0) return;

      setSettings((prev) => {
        const next = new Set(prev.skills.selected);
        let changed = prev.skills.enabled !== true;
        for (const name of installedNames) {
          if (!next.has(name)) {
            next.add(name);
            changed = true;
          }
        }
        if (!changed) return prev;
        return updateSkills(prev, {
          enabled: true,
          selected: Array.from(next),
        });
      });
    },
    [setSettings],
  );

  useEffect(() => {
    const activeJobs = Object.values(installJobs).filter(
      (job) => !TERMINAL_INSTALL_PHASES.has(job.phase),
    );
    if (activeJobs.length === 0) return;

    const timer = window.setInterval(() => {
      for (const job of activeJobs) {
        void getSkillInstallJobStatus(job.jobId)
          .then((next) => {
            setInstallJobs((prev) => ({ ...prev, [next.jobId]: next }));
            if (TERMINAL_INSTALL_PHASES.has(next.phase)) {
              if (next.phase === "done") {
                enableInstalledSkillsFromJob(next);
                void refresh({ silent: true });
              }
            }
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            setInstallJobs((prev) => ({
              ...prev,
              [job.jobId]: {
                ...job,
                phase: "error",
                error: msg || t("settings.skillsHubInstallStatusFailed"),
                finishedAt: Date.now(),
              },
            }));
          });
      }
    }, 600);

    return () => window.clearInterval(timer);
  }, [enableInstalledSkillsFromJob, installJobs, refresh, t]);

  async function loadMoreStore() {
    if (!storeCursor || storeLoading || storeLoadingMore || storeQuery.trim()) return;
    setStoreLoadingMore(true);
    setStoreError(null);
    try {
      const requestedLimit = Math.max(storeItems.length + STORE_PAGE_LIMIT, STORE_PAGE_LIMIT);
      const results = await listClawHubSkills({
        sort: storeSort,
        limit: requestedLimit,
      });
      const nextItems = dedupeStoreItems(results.items);
      if (nextItems.length > storeItems.length) {
        setStoreItems(nextItems);
        setStoreCursor(results.nextCursor);
      } else {
        setStoreCursor(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStoreError(msg || t("settings.skillsHubStoreLoadMoreFailed"));
    } finally {
      setStoreLoadingMore(false);
    }
  }

  async function installStoreSkill(skill: ClawHubSkillCard) {
    const initialStoreKey = buildClawHubSkillKey(skill);
    const initialJobId = installingByStoreKey[initialStoreKey];
    const initialJob = initialJobId ? installJobs[initialJobId] : undefined;
    if (
      lockedByChatMode ||
      pendingInstallTokensRef.current.has(initialStoreKey) ||
      installedStoreKeys.has(initialStoreKey) ||
      (!skill.ownerHandle && installedStoreSlugs.has(skill.slug)) ||
      (initialJob && !TERMINAL_INSTALL_PHASES.has(initialJob.phase))
    ) {
      return;
    }

    const pendingToken = Symbol(initialStoreKey);
    pendingInstallTokensRef.current.set(initialStoreKey, pendingToken);
    setPendingInstallKeys(new Set(pendingInstallTokensRef.current.keys()));
    setStoreError(null);
    try {
      const resolvedSkill = await resolveClawHubSkillOwner(skill);
      const storeKey = buildClawHubSkillKey(resolvedSkill);
      const activePendingToken = pendingInstallTokensRef.current.get(storeKey);
      if (activePendingToken && activePendingToken !== pendingToken) return;
      if (storeKey !== initialStoreKey) {
        pendingInstallTokensRef.current.set(storeKey, pendingToken);
        setPendingInstallKeys(new Set(pendingInstallTokensRef.current.keys()));
      }
      setStoreItems((prev) =>
        prev.map((item) =>
          item.slug === resolvedSkill.slug &&
          item.updatedAt === resolvedSkill.updatedAt &&
          (!item.ownerHandle || item.ownerHandle === resolvedSkill.ownerHandle)
            ? resolvedSkill
            : item,
        ),
      );
      const existingJobId = installingByStoreKey[storeKey];
      const existingJob = existingJobId ? installJobs[existingJobId] : undefined;
      if (
        installedStoreKeys.has(storeKey) ||
        (existingJob && !TERMINAL_INSTALL_PHASES.has(existingJob.phase))
      ) {
        return;
      }
      const job = await startSkillInstallJob({
        source: buildClawHubDownloadUrl(resolvedSkill.slug, resolvedSkill.ownerHandle),
        label: resolvedSkill.displayName,
        slug: resolvedSkill.slug,
        ownerHandle: resolvedSkill.ownerHandle,
        version: resolvedSkill.latestVersion,
        conflict: "backup",
      });
      setInstallJobs((prev) => ({ ...prev, [job.jobId]: job }));
      setInstallingByStoreKey((prev) => ({
        ...prev,
        [initialStoreKey]: job.jobId,
        [storeKey]: job.jobId,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStoreError(msg || t("settings.skillsHubInstallFailed"));
    } finally {
      let changed = false;
      for (const [storeKey, token] of pendingInstallTokensRef.current) {
        if (token !== pendingToken) continue;
        pendingInstallTokensRef.current.delete(storeKey);
        changed = true;
      }
      if (changed) {
        setPendingInstallKeys(new Set(pendingInstallTokensRef.current.keys()));
      }
    }
  }

  async function deleteSkill(skill: SkillSummary) {
    if (lockedByChatMode || isAlwaysEnabledSkillName(skill.name) || deletingSkillName) return;
    const skillName = skill.name;
    const sourceSlug = skill.source?.registry === "clawhub" ? skill.source.slug?.trim() || "" : "";
    const sourceOwnerHandle =
      skill.source?.registry === "clawhub" ? skill.source.ownerHandle?.trim() || null : null;
    setLoadError(null);
    setDeletingSkillName(skillName);
    try {
      await manageSkill({ action: "delete", name: skillName });
      setSettings((prev) =>
        removeWorkspaceResourceReferences(
          updateSkills(prev, {
            selected: prev.skills.selected.filter((name) => name !== skillName),
          }),
          { skillNames: [skillName] },
        ),
      );
      setSkills((prev) => prev.filter((item) => item.name !== skillName));
      setPreviewInstalledSkill((current) => (current?.name === skillName ? null : current));
      if (sourceSlug) {
        const sourceKey = buildClawHubSkillKey({
          slug: sourceSlug,
          ownerHandle: sourceOwnerHandle,
        });
        setInstallingByStoreKey((prev) => {
          if (!(sourceKey in prev)) return prev;
          const next = { ...prev };
          delete next[sourceKey];
          return next;
        });
        setInstallJobs((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [jobId, job] of Object.entries(prev)) {
            if (
              job.slug?.trim() === sourceSlug &&
              (!sourceOwnerHandle || job.ownerHandle?.trim() === sourceOwnerHandle)
            ) {
              delete next[jobId];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      notifySkillsDiscoveryUpdated();
      await refresh({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg || t("settings.skillsHubDeleteFailed"));
    } finally {
      setDeletingSkillName(null);
    }
  }

  function toggleSkill(name: string, on: boolean) {
    if (isAlwaysEnabledSkillName(name)) return;
    const next = new Set(settings.skills.selected);
    if (on) next.add(name);
    else next.delete(name);
    requestInstalledSkillFlip("single", [name], on ? [name] : []);
    setSettings((prev) => updateSkills(prev, { selected: Array.from(next) }));
  }

  const clearBulkUndoTimer = useCallback(() => {
    if (bulkUndoTimerRef.current !== null) {
      window.clearTimeout(bulkUndoTimerRef.current);
      bulkUndoTimerRef.current = null;
    }
  }, []);

  const exitBulkMode = useCallback(() => {
    setBulkMode(false);
    setBulkSelection(new Set());
    bulkAnchorRef.current = null;
  }, []);

  const enterBulkMode = useCallback(
    (initialName?: string) => {
      setBulkMode(true);
      setPreviewInstalledSkill(null);
      if (initialName && !isAlwaysEnabledSkillName(initialName)) {
        clearBulkUndoTimer();
        setBulkUndo(null);
        setBulkSelection(new Set([initialName]));
        bulkAnchorRef.current = initialName;
      }
    },
    [clearBulkUndoTimer],
  );

  const toggleBulkSelectionName = useCallback(
    (name: string) => {
      if (isAlwaysEnabledSkillName(name)) return;
      clearBulkUndoTimer();
      setBulkUndo(null);
      setBulkSelection((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      bulkAnchorRef.current = name;
    },
    [clearBulkUndoTimer],
  );

  const setBulkSelectionRange = useCallback(
    (names: readonly string[], select: boolean) => {
      const selectable = names.filter((name) => !isAlwaysEnabledSkillName(name));
      if (selectable.length === 0) return;
      clearBulkUndoTimer();
      setBulkUndo(null);
      setBulkSelection((prev) => {
        const next = new Set(prev);
        for (const name of selectable) {
          if (select) next.add(name);
          else next.delete(name);
        }
        return next;
      });
    },
    [clearBulkUndoTimer],
  );

  // 批量选择模式下点击卡片：只改 bulkSelection，不改启用状态、不打开预览。
  function handleBulkInstalledCardClick(name: string, orderedNames: string[], shiftKey: boolean) {
    if (isAlwaysEnabledSkillName(name)) return;
    const currentlySelected = bulkSelection.has(name);
    const target = !currentlySelected;

    if (shiftKey && bulkAnchorRef.current && bulkAnchorRef.current !== name) {
      const from = orderedNames.indexOf(bulkAnchorRef.current);
      const to = orderedNames.indexOf(name);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setBulkSelectionRange(orderedNames.slice(lo, hi + 1), target);
        bulkAnchorRef.current = name;
        return;
      }
    }

    toggleBulkSelectionName(name);
  }

  // 批量启用/禁用：作用于 bulkSelection，成功后清空选择并弹出 Undo。
  // 副作用（Undo 快照/定时器/清空选择）都放在 setSettings 之外：
  // 传给 setSettings 的 updater 必须是纯函数（StrictMode 会双调用）。
  const applyBulkEnableState = useCallback(
    (target: boolean) => {
      const names = [...bulkSelection].filter((name) => !isAlwaysEnabledSkillName(name));
      if (names.length === 0) return;

      const before = settings.skills.selected;
      const current = new Set(before);
      const changedNames = names.filter((name) =>
        target ? !current.has(name) : current.has(name),
      );
      const changed = changedNames.length;
      if (changed === 0) return;

      requestInstalledSkillFlip("batch", changedNames, target ? changedNames : []);
      clearBulkUndoTimer();
      setBulkUndo({ selected: before, count: changed });
      bulkUndoTimerRef.current = window.setTimeout(() => {
        setBulkUndo(null);
        bulkUndoTimerRef.current = null;
      }, 6000);
      setBulkSelection(new Set());
      bulkAnchorRef.current = null;
      setSettings((prev) => {
        const next = new Set(prev.skills.selected);
        for (const name of names) {
          if (target) next.add(name);
          else next.delete(name);
        }
        return updateSkills(prev, {
          enabled: target ? true : prev.skills.enabled,
          selected: Array.from(next),
        });
      });
    },
    [
      bulkSelection,
      clearBulkUndoTimer,
      requestInstalledSkillFlip,
      setSettings,
      settings.skills.selected,
    ],
  );

  const undoBulkSelection = useCallback(() => {
    clearBulkUndoTimer();
    if (bulkUndo) {
      const restore = bulkUndo.selected;
      const current = new Set(settings.skills.selected);
      const restoreSet = new Set(restore);
      const changedNames = [...new Set([...current, ...restoreSet])].filter(
        (name) => !isAlwaysEnabledSkillName(name) && current.has(name) !== restoreSet.has(name),
      );
      const followNames = changedNames.filter((name) => restoreSet.has(name) && !current.has(name));
      requestInstalledSkillFlip("batch", changedNames, followNames);
      setSettings((prev) => updateSkills(prev, { selected: restore }));
    }
    setBulkUndo(null);
  }, [
    bulkUndo,
    clearBulkUndoTimer,
    requestInstalledSkillFlip,
    setSettings,
    settings.skills.selected,
  ]);

  async function deleteBulkSelectedInstalledSkills() {
    if (lockedByChatMode || deletingSkillName || !bulkMode) return;
    const targets = skills.filter(
      (skill) => bulkSelection.has(skill.name) && !isAlwaysEnabledSkillName(skill.name),
    );
    if (targets.length === 0) return;

    setLoadError(null);
    const failures: string[] = [];
    for (const skill of targets) {
      setDeletingSkillName(skill.name);
      try {
        await manageSkill({ action: "delete", name: skill.name });
        setSettings((prev) =>
          removeWorkspaceResourceReferences(
            updateSkills(prev, {
              selected: prev.skills.selected.filter((name) => name !== skill.name),
            }),
            { skillNames: [skill.name] },
          ),
        );
        setSkills((prev) => prev.filter((item) => item.name !== skill.name));
        setPreviewInstalledSkill((current) => (current?.name === skill.name ? null : current));
        setBulkSelection((prev) => {
          if (!prev.has(skill.name)) return prev;
          const next = new Set(prev);
          next.delete(skill.name);
          return next;
        });
        const sourceSlug =
          skill.source?.registry === "clawhub" ? skill.source.slug?.trim() || "" : "";
        const sourceOwnerHandle =
          skill.source?.registry === "clawhub" ? skill.source.ownerHandle?.trim() || null : null;
        if (sourceSlug) {
          const sourceKey = buildClawHubSkillKey({
            slug: sourceSlug,
            ownerHandle: sourceOwnerHandle,
          });
          setInstallingByStoreKey((prev) => {
            if (!(sourceKey in prev)) return prev;
            const next = { ...prev };
            delete next[sourceKey];
            return next;
          });
          setInstallJobs((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [jobId, job] of Object.entries(prev)) {
              if (
                job.slug?.trim() === sourceSlug &&
                (!sourceOwnerHandle || job.ownerHandle?.trim() === sourceOwnerHandle)
              ) {
                delete next[jobId];
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${skill.name}: ${msg || t("settings.skillsHubDeleteFailed")}`);
      }
    }
    setDeletingSkillName(null);
    if (failures.length > 0) {
      setLoadError(`${t("settings.skillsHubBulkDeleteFailed")}: ${failures.join("; ")}`);
    }
    notifySkillsDiscoveryUpdated();
    await refresh({ silent: true });
  }

  useEffect(() => clearBulkUndoTimer, [clearBulkUndoTimer]);

  // 切换视图时退出批量模式并清空选择与锚点。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只需在 view 变化时触发；exitBulkMode 是稳定回调
  useEffect(() => {
    exitBulkMode();
  }, [view]);

  // Esc: clear selection first, then exit bulk mode.
  useEffect(() => {
    if (!bulkMode || lockedByChatMode) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (bulkSelection.size > 0) {
          setBulkSelection(new Set());
          bulkAnchorRef.current = null;
        } else {
          exitBulkMode();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        ) {
          return;
        }
        // 「全选当前筛选」只对已安装页有定义；其余视图保留浏览器默认 Ctrl+A。
        if (view !== "installed") return;
        event.preventDefault();
        setBulkSelectionRange(filteredSelectableInstalledNames, true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    bulkMode,
    bulkSelection.size,
    exitBulkMode,
    filteredSelectableInstalledNames,
    lockedByChatMode,
    setBulkSelectionRange,
    view,
  ]);

  const bulkSelectedVisibleCount = useMemo(
    () =>
      filteredSelectableInstalledNames.reduce(
        (count, name) => count + (bulkSelection.has(name) ? 1 : 0),
        0,
      ),
    [bulkSelection, filteredSelectableInstalledNames],
  );
  const bulkSelectedHiddenCount = Math.max(0, bulkSelection.size - bulkSelectedVisibleCount);
  const bulkEnableChangeCount = useMemo(() => {
    let count = 0;
    for (const name of bulkSelection) {
      if (isAlwaysEnabledSkillName(name)) continue;
      if (!selected.has(name)) count += 1;
    }
    return count;
  }, [bulkSelection, selected]);
  const bulkDisableChangeCount = useMemo(() => {
    let count = 0;
    for (const name of bulkSelection) {
      if (isAlwaysEnabledSkillName(name)) continue;
      if (selected.has(name)) count += 1;
    }
    return count;
  }, [bulkSelection, selected]);
  const bulkDeleteNames = useMemo(
    () => [...bulkSelection].filter((name) => !isAlwaysEnabledSkillName(name)),
    [bulkSelection],
  );
  const bulkDeletePreview = useMemo(() => {
    const names = bulkDeleteNames.slice(0, 5);
    if (names.length === 0) return "";
    const rest = bulkDeleteNames.length - names.length;
    const joined = names.join(", ");
    return rest > 0
      ? t("settings.skillsHubBulkDeleteMore")
          .replace("{names}", joined)
          .replace("{count}", String(rest))
      : joined;
  }, [bulkDeleteNames, t]);

  function openInstalledSkillPreview(skill: SkillSummary) {
    setPreviewInstalledSkill(skill);
  }

  // memo 卡片的回调走 latest-ref（先例 file-tree）：引用恒定使 memo 不失效，
  // 实现经 ref 每渲染更新到最新闭包。
  const sortedInstalledNames = useMemo(
    () => sortedFiltered.map(({ skill }) => skill.name),
    [sortedFiltered],
  );
  const cardHandlersRef = useRef({
    toggleSkill,
    deleteSkill,
    openInstalledSkillPreview,
    handleBulkInstalledCardClick,
    sortedNames: [] as string[],
  });
  useEffect(() => {
    cardHandlersRef.current = {
      toggleSkill,
      deleteSkill,
      openInstalledSkillPreview,
      handleBulkInstalledCardClick,
      sortedNames: sortedInstalledNames,
    };
  });
  const handleCardToggle = useCallback(
    (name: string, on: boolean) => cardHandlersRef.current.toggleSkill(name, on),
    [],
  );
  const handleCardDelete = useCallback(
    (skill: SkillSummary) => void cardHandlersRef.current.deleteSkill(skill),
    [],
  );
  const handleCardOpenPreview = useCallback(
    (skill: SkillSummary) => cardHandlersRef.current.openInstalledSkillPreview(skill),
    [],
  );
  const handleCardBulkClick = useCallback((name: string, shiftKey: boolean) => {
    const { handleBulkInstalledCardClick, sortedNames } = cardHandlersRef.current;
    handleBulkInstalledCardClick(name, sortedNames, shiftKey);
  }, []);

  function setSkillsEnabled(enabled: boolean) {
    setSettings((prev) => updateSkills(prev, { enabled }));
  }

  const skillsEnabled = settings.skills.enabled;
  const showInitialInstalledContentLoading =
    skills.length > 0 && !hasPresentedInstalledSkills && installedContentPending;
  const skillsStatusHint = lockedByChatMode
    ? t("settings.skillsDisabledInChatMode")
    : skillsEnabled
      ? null
      : null;

  return (
    <div className="hub-page hub-page-enter relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <HubBackdrop tone="amber" />

      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <HubHeader
          icon={<Blend className="h-6 w-6" />}
          title={t("settings.skillsHubTitle")}
          subtitle={rootDir ? rootDir : t("settings.skillsHubSubtitle")}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={onOpenSidebar}
        />

        <div className="hub-scroll min-h-0 flex-1 overflow-hidden px-5 pb-6 pt-2 sm:px-6 lg:px-8 xl:px-10">
          <div className="hub-content-stage mx-auto flex h-full min-h-0 w-full max-w-[1320px] flex-col gap-4">
            {/* Status pill row */}
            <div
              className={cn(
                "hub-panel-enter relative overflow-hidden rounded-2xl border backdrop-blur-xl",
                skillsEnabled
                  ? "border-border/70 bg-card shadow-xs"
                  : "border-border/70 bg-muted/40 shadow-xs",
              )}
            >
              <div className="flex items-center gap-3 px-4 py-3.5 sm:gap-x-5 sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-3.5">
                  <div
                    className={cn(
                      "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-colors",
                      skillsEnabled
                        ? "border-border/70 bg-background text-foreground shadow-xs"
                        : "border-border/70 bg-background/60 text-muted-foreground",
                    )}
                  >
                    <Plug className="h-5 w-5" />
                    {skillsEnabled ? (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="text-[13.5px] font-semibold tracking-tight text-foreground">
                        {skillsEnabled
                          ? t("settings.skillsHubEnabled")
                          : t("settings.skillsHubDisabled")}
                      </div>
                      {selectableSkills.length > 0 && (
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums backdrop-blur-md",
                            selectedCount > 0
                              ? "bg-muted text-foreground ring-1 ring-border/60"
                              : "bg-background text-muted-foreground ring-1 ring-border/60",
                          )}
                        >
                          <span className="font-semibold">{selectedCount}</span>
                          <span className="opacity-50">/</span>
                          <span className="opacity-80">{selectableSkills.length}</span>
                          <span className="ml-0.5 opacity-70">
                            {t("settings.skillsHubSelectedShort")}
                          </span>
                        </span>
                      )}
                    </div>
                    {skillsStatusHint ? (
                      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        {skillsStatusHint}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    tone="success"
                    checked={skillsEnabled}
                    disabled={lockedByChatMode}
                    onCheckedChange={setSkillsEnabled}
                    aria-label={
                      skillsEnabled
                        ? t("settings.skillsHubToggleDisable")
                        : t("settings.skillsHubToggleEnable")
                    }
                    title={
                      skillsEnabled
                        ? t("settings.skillsHubToggleDisable")
                        : t("settings.skillsHubToggleEnable")
                    }
                  />

                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 shrink-0 gap-1 rounded-lg border-border/70 bg-card px-2.5 text-foreground shadow-xs",
                      loading && "bg-muted/50",
                    )}
                    onClick={() => void refresh()}
                    disabled={loading || lockedByChatMode}
                    title={loading ? t("settings.skillsScanning") : t("settings.skillsScan")}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                    <span className="hidden items-center whitespace-nowrap leading-none sm:inline-flex">
                      <span>
                        {loading ? t("settings.skillsScanning") : t("settings.skillsScan")}
                      </span>
                      {loading ? <ScanActivityDots /> : null}
                    </span>
                  </Button>
                </div>
              </div>
            </div>

            <Tabs
              value={view}
              onValueChange={(nextView) => {
                if (isSkillsHubView(nextView)) setView(nextView);
              }}
              className="flex min-h-0 flex-1 flex-col gap-4"
            >
              <div className="hub-panel-enter flex items-center justify-between gap-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
                <TabsList className="h-10 shrink-0 rounded-xl border border-border/70 bg-muted/50 p-1 text-muted-foreground shadow-xs max-sm:max-w-full max-sm:justify-start max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
                  {[
                    {
                      value: "installed" as const,
                      label: t("settings.skillsHubInstalledTab"),
                      icon: Server,
                      count: selectableSkills.length,
                    },
                    {
                      value: "store" as const,
                      label: t("settings.skillsHubStoreTab"),
                      icon: Cloud,
                      count: null,
                    },
                    {
                      value: "import" as const,
                      label: t("settings.skillsHubImportTab"),
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
                          "relative h-8 gap-1.5 rounded-lg px-3 text-[12.5px] data-[active]:ring-1 data-[active]:ring-border/60 max-sm:shrink-0",
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

                {!lockedByChatMode ? (
                  <div className="flex w-full min-w-0 items-center justify-end gap-2">
                    {view !== "store" ? (
                      <Button
                        variant="outline"
                        aria-pressed={bulkMode}
                        onClick={() => {
                          if (bulkMode) exitBulkMode();
                          else enterBulkMode();
                        }}
                        title={
                          view === "installed"
                            ? t("settings.skillsBulkHint")
                            : t("settings.skillsBulkImportHint")
                        }
                        className={cn(
                          "h-10 shrink-0 gap-1.5 whitespace-nowrap rounded-xl border-border/70 px-3 text-[12.5px] shadow-xs max-sm:px-2.5",
                          bulkMode
                            ? "border-primary/50 bg-primary/10 text-foreground ring-1 ring-primary/25 hover:bg-primary/15"
                            : "bg-card text-foreground/80 hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                        <span>
                          {bulkMode ? t("settings.skillsBulkDone") : t("settings.skillsBulkSelect")}
                        </span>
                      </Button>
                    ) : null}
                    {view === "installed" ? (
                      <Select
                        value={installedSort}
                        onValueChange={(value) => {
                          if (!isInstalledSkillSort(value) || value === installedSort) return;
                          const followKey = captureInstalledFlipKey();
                          requestInstalledFlip("wave", [], followKey ? [followKey] : []);
                          setInstalledSort(value);
                        }}
                      >
                        <SelectTrigger
                          aria-label={t("settings.skillsInstalledSortLabel")}
                          title={t("settings.skillsInstalledSortLabel")}
                          className="h-10 w-auto max-w-[11rem] shrink-0 gap-2 rounded-xl border-border/70 bg-card px-3 text-[12.5px] font-medium text-foreground shadow-xs max-sm:max-w-[8rem] max-sm:px-2.5"
                        >
                          <SelectValue>
                            {t(
                              INSTALLED_SORT_OPTIONS.find(
                                (option) => option.value === installedSort,
                              )?.labelKey ?? INSTALLED_SORT_OPTIONS[0].labelKey,
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {INSTALLED_SORT_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value} className="text-xs">
                              {t(option.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <div className="relative w-full min-w-0 max-w-md max-sm:flex-1">
                      <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="text"
                        value={
                          view === "installed"
                            ? filter
                            : view === "store"
                              ? storeQuery
                              : importQuery
                        }
                        onChange={(e) => {
                          const value = e.currentTarget.value;
                          if (view === "installed") {
                            setFilter(value);
                          } else if (view === "store") {
                            setStoreQuery(value);
                          } else {
                            setImportQuery(value);
                          }
                        }}
                        placeholder={
                          view === "installed"
                            ? t("settings.skillsSearch")
                            : view === "store"
                              ? t("settings.skillsStoreSearch")
                              : t("settings.skillsImportSearchPlaceholder")
                        }
                        className="h-10 rounded-xl border-border/70 bg-card pl-10 pr-3 text-[13px] shadow-xs placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/20"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {lockedByChatMode ? (
                  <div className="h-full min-h-0 overflow-y-auto pb-4 pr-1">
                    <GlassPanel tone="muted" className="hub-panel-enter">
                      <div className="flex items-start gap-3">
                        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {t("settings.skillsDisabledInChatMode")}
                        </span>
                      </div>
                    </GlassPanel>
                  </div>
                ) : (
                  <>
                    <TabsContent value="installed" className="h-full min-h-0">
                      <div
                        aria-busy={loading || showInitialInstalledContentLoading}
                        className={cn(
                          "h-full min-h-0 overflow-y-auto px-0.5 pr-1 pt-1.5 [overflow-anchor:none]",
                          bulkMode
                            ? "pb-[calc(10rem+env(safe-area-inset-bottom))] sm:pb-24"
                            : "pb-4",
                        )}
                      >
                        <div className="flex flex-col gap-5">
                          {skills.length > 0 ? (
                            <StoreCategoryChips
                              value={installedCategory}
                              counts={installedCategoryCounts}
                              onChange={setInstalledCategory}
                              className="sticky top-0 z-30 -mx-0.5 -mt-1.5 bg-background/95 px-0.5 pb-2 pt-1.5 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.45)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 dark:shadow-[0_14px_24px_-22px_rgba(0,0,0,0.8)]"
                            />
                          ) : null}

                          {bulkMode ? (
                            <div className="hub-panel-enter flex items-center gap-2 text-[11px] text-muted-foreground/80">
                              <ListChecks className="h-3.5 w-3.5 shrink-0" />
                              <span>{t("settings.skillsBulkHint")}</span>
                            </div>
                          ) : null}

                          {loadError ? (
                            <GlassPanel tone="error" className="hub-panel-enter">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                                <span className="text-xs text-destructive">{loadError}</span>
                              </div>
                            </GlassPanel>
                          ) : null}

                          {!skillsEnabled ? (
                            <GlassPanel tone="muted" className="hub-panel-enter">
                              <div className="flex items-center gap-2">
                                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  {t("settings.skillsDisabledHint")}
                                </span>
                              </div>
                            </GlassPanel>
                          ) : null}

                          {!loading && skills.length === 0 && !loadError ? (
                            <GlassPanel className="hub-panel-enter">
                              <div className="flex flex-col items-center gap-3 py-8 text-center">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60">
                                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">
                                    {t("settings.skillsNotFound")}
                                  </p>
                                  <p className="text-xs text-muted-foreground/70">
                                    {t("settings.skillsNotFoundHint")}
                                  </p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mt-1 gap-1.5 rounded-full"
                                  onClick={() => void refresh()}
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  {t("settings.skillsRescan")}
                                </Button>
                              </div>
                            </GlassPanel>
                          ) : null}

                          {loading && skills.length === 0 ? (
                            <SkillsContentLoadingState
                              title={t("settings.skillsScanning")}
                              description={t("settings.skillsHubScanning")}
                            />
                          ) : showInitialInstalledContentLoading ? (
                            <SkillsContentLoadingState
                              title={t("settings.skillsHubPreparing")}
                              description={t("settings.skillsHubPreparingDesc")}
                            />
                          ) : null}

                          {sortedFiltered.length > 0 ? (
                            <div
                              ref={installedGridRef}
                              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                            >
                              {sortedFiltered.map(({ skill, categories }) => {
                                const alwaysEnabled = isAlwaysEnabledSkillName(skill.name);
                                const key = `${skill.name}-${rootDir}`;
                                return (
                                  <InstalledSkillCard
                                    key={key}
                                    flipKey={key}
                                    skill={skill}
                                    primaryCategory={categories[0] ?? "other"}
                                    alwaysEnabled={alwaysEnabled}
                                    checked={alwaysEnabled || selected.has(skill.name)}
                                    bulkMode={bulkMode}
                                    bulkSelected={bulkSelection.has(skill.name)}
                                    deleting={deletingSkillName === skill.name}
                                    deleteDisabled={deletingSkillName !== null}
                                    onToggle={handleCardToggle}
                                    onEnterBulkMode={enterBulkMode}
                                    onToggleBulkSelection={toggleBulkSelectionName}
                                    onBulkCardClick={handleCardBulkClick}
                                    onOpenPreview={handleCardOpenPreview}
                                    onDelete={handleCardDelete}
                                    onSelectCategory={setInstalledCategory}
                                  />
                                );
                              })}
                            </div>
                          ) : null}

                          {(filter.trim() || installedCategory !== "all") &&
                          sortedFiltered.length === 0 &&
                          skills.length > 0 ? (
                            <GlassPanel tone="muted" className="hub-panel-enter">
                              <p className="py-2 text-center text-sm text-muted-foreground">
                                {filter.trim()
                                  ? t("settings.skillsNoMatch").replace("{filter}", filter)
                                  : t("settings.skillsStoreEmptyTitle")}
                              </p>
                            </GlassPanel>
                          ) : null}
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="store" className="h-full min-h-0">
                      <SkillsStoreView
                        items={storeItems}
                        query={storeQuery}
                        sort={storeSort}
                        loading={storeLoading}
                        loadingMore={storeLoadingMore}
                        error={storeError}
                        cursor={storeCursor}
                        installedKeys={installedStoreKeys}
                        installedSlugs={installedStoreSlugs}
                        pendingInstallKeys={pendingInstallKeys}
                        installingByStoreKey={installingByStoreKey}
                        installJobs={installJobs}
                        onSortChange={setStoreSort}
                        onLoadMore={() => void loadMoreStore()}
                        onInstall={(skill) => void installStoreSkill(skill)}
                      />
                    </TabsContent>
                    <TabsContent value="import" className="h-full min-h-0">
                      <SkillsImportView
                        scans={externalScans ?? []}
                        importingExternalBaseDir={importingExternalBaseDir}
                        loading={externalLoading}
                        error={externalError}
                        query={importQuery}
                        selected={selectedExternal}
                        installedNames={installedSkillNames}
                        importProgress={importProgress}
                        importErrors={importErrors}
                        importedCount={importedCount}
                        importToast={importToast}
                        onDismissImportToast={() => {
                          if (importToastTimerRef.current !== null) {
                            window.clearTimeout(importToastTimerRef.current);
                            importToastTimerRef.current = null;
                          }
                          setImportToast(null);
                        }}
                        bulkMode={bulkMode}
                        onToggle={toggleExternalSkill}
                        onBatchToggle={batchToggleExternalSkills}
                        onRescan={() => void rescanExternalSkills()}
                        onImport={(skill) => void importSelectedExternalSkills(skill)}
                      />
                    </TabsContent>
                  </>
                )}
              </div>
            </Tabs>
          </div>
        </div>
      </div>
      {previewInstalledSkill ? (
        <InstalledSkillPreviewDrawer
          skill={previewInstalledSkill}
          preview={installedPreviewState}
          checked={
            isAlwaysEnabledSkillName(previewInstalledSkill.name) ||
            selected.has(previewInstalledSkill.name)
          }
          skillsEnabled={skillsEnabled}
          onClose={() => setPreviewInstalledSkill(null)}
        />
      ) : null}

      {bulkMode &&
      view === "installed" &&
      !lockedByChatMode &&
      (!bulkUndo || bulkSelection.size > 0) ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3 max-sm:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="hub-panel-enter pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-full border border-border/50 bg-background/95 py-2 pl-4 pr-2 text-[12.5px] shadow-[0_8px_24px_-12px_rgba(15,23,42,0.35)] max-sm:justify-center max-sm:rounded-3xl max-sm:whitespace-nowrap dark:border-white/[0.1] dark:bg-popover/95">
            {bulkSelection.size > 0 ? (
              <>
                <span className="whitespace-nowrap text-foreground/85">
                  {t("settings.skillsBulkSelectedCount").replace(
                    "{count}",
                    String(bulkSelection.size),
                  )}
                  {bulkSelectedHiddenCount > 0
                    ? ` ${t("settings.skillsBulkNotInFilter").replace("{count}", String(bulkSelectedHiddenCount))}`
                    : ""}
                </span>
                <span className="hidden text-muted-foreground/50 sm:inline" aria-hidden="true">
                  │
                </span>
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.08]"
                  onClick={() => setBulkSelectionRange(filteredSelectableInstalledNames, true)}
                >
                  {t("settings.skillsBulkSelectAll")}
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.08]"
                  onClick={() => {
                    setBulkSelection(new Set());
                    bulkAnchorRef.current = null;
                  }}
                >
                  {t("settings.skillsBulkClear")}
                </button>
                <span className="hidden text-muted-foreground/50 sm:inline" aria-hidden="true">
                  │
                </span>
                <button
                  type="button"
                  disabled={bulkEnableChangeCount === 0}
                  className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => applyBulkEnableState(true)}
                >
                  {`${t("settings.skillsBulkEnable")}${bulkEnableChangeCount > 0 ? ` (${bulkEnableChangeCount})` : ""}`}
                </button>
                <button
                  type="button"
                  disabled={bulkDisableChangeCount === 0}
                  className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => applyBulkEnableState(false)}
                >
                  {`${t("settings.skillsBulkDisable")}${bulkDisableChangeCount > 0 ? ` (${bulkDisableChangeCount})` : ""}`}
                </button>
                <ConfirmActionPopover
                  title={t("settings.deleteConfirm")}
                  description={`${t("settings.skillsHubBulkDeleteConfirm").replace("{count}", String(bulkDeleteNames.length))}${bulkDeletePreview ? ` ${bulkDeletePreview}` : ""}`}
                  confirmLabel={t("settings.delete")}
                  onConfirm={() => void deleteBulkSelectedInstalledSkills()}
                >
                  {(open) => (
                    <button
                      type="button"
                      disabled={bulkDeleteNames.length === 0 || deletingSkillName !== null}
                      onClick={open}
                      className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {`${t("settings.skillsHubBulkDelete")}${bulkDeleteNames.length > 0 ? ` (${bulkDeleteNames.length})` : ""}`}
                    </button>
                  )}
                </ConfirmActionPopover>
                <button
                  type="button"
                  onClick={exitBulkMode}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-foreground/[0.08] px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.14]"
                >
                  <X className="h-3.5 w-3.5" />
                  {t("settings.skillsBulkDone")}
                </button>
              </>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {t("settings.skillsBulkClickToSelect")}
                </span>
                <button
                  type="button"
                  onClick={exitBulkMode}
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-foreground/[0.08] px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.14]"
                >
                  {t("settings.skillsBulkDone")}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {bulkUndo && bulkSelection.size === 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3 max-sm:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="hub-panel-enter pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-full border border-border/50 bg-background/95 py-2 pl-4 pr-2 text-[12.5px] shadow-[0_8px_24px_-12px_rgba(15,23,42,0.35)] dark:border-white/[0.1] dark:bg-popover/95">
            <span className="text-foreground/85">
              {t("settings.skillsBulkUpdated").replace("{count}", String(bulkUndo.count))}
            </span>
            <button
              type="button"
              onClick={undoBulkSelection}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-foreground/[0.08] px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.14]"
            >
              {t("settings.skillsBulkUndo")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
