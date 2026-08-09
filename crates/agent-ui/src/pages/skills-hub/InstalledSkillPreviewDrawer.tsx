import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Lock,
  SkillIcon,
  X,
} from "@liveagent/app/components/icons";
import { Markdown } from "@liveagent/ui/components/Markdown";
import { useLocale } from "@liveagent/ui/i18n/index";
import { cn } from "@liveagent/ui/lib/shared/utils";
import { isAlwaysEnabledSkillName, type SkillSummary } from "@liveagent/ui/lib/skills/index";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const INSTALLED_SKILL_PREVIEW_LINES = 10_000;
const COPY_FEEDBACK_MS = 1600;

export type InstalledSkillPreviewState = {
  skillFile: string;
  content: string;
  truncated: boolean;
  loading: boolean;
  error: string | null;
};

export function emptyInstalledSkillPreviewState(): InstalledSkillPreviewState {
  return {
    skillFile: "",
    content: "",
    truncated: false,
    loading: false,
    error: null,
  };
}

function fallbackCopyText(text: string) {
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopyText(text);
    }
  }
  return fallbackCopyText(text);
}

function normalizePreviewMetadataText(value: string) {
  return value
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripLeadingBlankLines(lines: string[]) {
  let index = 0;
  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }
  return lines.slice(index);
}

function stripReadmeDuplicateSummary(content: string, skill: SkillSummary) {
  const expectedName = normalizePreviewMetadataText(skill.name);
  const expectedDescription = normalizePreviewMetadataText(skill.description);
  let lines = stripLeadingBlankLines(content.split(/\r?\n/));

  if (lines.length > 0 && normalizePreviewMetadataText(lines[0]) === expectedName) {
    lines = stripLeadingBlankLines(lines.slice(1));
  }

  if (expectedDescription && lines.length > 0) {
    const paragraph: string[] = [];
    let index = 0;
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (normalizePreviewMetadataText(paragraph.join(" ")) === expectedDescription) {
      lines = stripLeadingBlankLines(lines.slice(index));
    }
  }

  return lines.join("\n").trimStart();
}

const FRONTMATTER_PREVIEW_METADATA_KEYS = new Set(["name", "description"]);

function hasPreviewMetadataFrontmatterField(frontmatterBody: string) {
  return frontmatterBody.split(/\r?\n/).some((line) => {
    if (/^[ \t]/.test(line)) return false;
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:/);
    return match ? FRONTMATTER_PREVIEW_METADATA_KEYS.has(match[1].toLowerCase()) : false;
  });
}

function hasPreviewMetadataInlineFrontmatterField(frontmatterBody: string) {
  return Array.from(frontmatterBody.matchAll(/(?:^|\s)([A-Za-z0-9_-]+)\s*:/g)).some((match) =>
    FRONTMATTER_PREVIEW_METADATA_KEYS.has(match[1].toLowerCase()),
  );
}

function hasDisplayableFrontmatterContent(frontmatterBody: string) {
  return frontmatterBody.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

function stripFrontmatterPreviewMetadataFields(frontmatterBody: string) {
  const lines = frontmatterBody.split(/\r?\n/);
  const nextLines: string[] = [];
  let skippingMetadataField = false;

  for (const line of lines) {
    const isIndented = /^[ \t]/.test(line);
    const trimmed = line.trim();
    const keyMatch = isIndented ? null : line.match(/^([A-Za-z0-9_-]+)\s*:/);

    if (keyMatch) {
      skippingMetadataField = FRONTMATTER_PREVIEW_METADATA_KEYS.has(keyMatch[1].toLowerCase());
      if (skippingMetadataField) continue;
    } else if (skippingMetadataField) {
      if (trimmed === "" || isIndented) continue;
      skippingMetadataField = false;
    }

    nextLines.push(line);
  }

  return nextLines.join("\n").trim();
}

function stripInlineFrontmatterPreviewMetadataFields(frontmatterBody: string) {
  const matches = Array.from(frontmatterBody.matchAll(/(?:^|\s)([A-Za-z0-9_-]+)\s*:/g));
  if (matches.length === 0) return frontmatterBody.trim();

  const fields = matches.map((match, index) => {
    const rawIndex = match.index ?? 0;
    const startsWithSpace = /^\s/.test(match[0]);
    const start = rawIndex + (startsWithSpace ? 1 : 0);
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? frontmatterBody.length)
        : frontmatterBody.length;
    return {
      key: match[1].toLowerCase(),
      text: frontmatterBody.slice(start, end).trim(),
    };
  });

  return fields
    .filter((field) => !FRONTMATTER_PREVIEW_METADATA_KEYS.has(field.key))
    .map((field) => field.text)
    .join(" ")
    .trim();
}

function stripMarkdownSkillMetadata(content: string, skill: SkillSummary) {
  let next = content.replace(/^\uFEFF/, "");
  const frontmatter = next.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (frontmatter && hasPreviewMetadataFrontmatterField(frontmatter[1])) {
    const frontmatterBody = stripFrontmatterPreviewMetadataFields(frontmatter[1]);
    const rest = next.slice(frontmatter[0].length);
    next = hasDisplayableFrontmatterContent(frontmatterBody)
      ? `---\n${frontmatterBody}\n---\n${rest}`
      : rest;
  } else {
    const inlineFrontmatter = next.match(/^---[ \t]+([\s\S]*?)[ \t]+---[ \t]*/);
    if (inlineFrontmatter && hasPreviewMetadataInlineFrontmatterField(inlineFrontmatter[1])) {
      const frontmatterBody = stripInlineFrontmatterPreviewMetadataFields(inlineFrontmatter[1]);
      const rest = next.slice(inlineFrontmatter[0].length);
      next = frontmatterBody ? `--- ${frontmatterBody} --- ${rest}` : rest;
    }
  }
  return stripReadmeDuplicateSummary(next, skill);
}

function stripJsonSkillMetadata(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return content;
    const next = { ...(parsed as Record<string, unknown>) };
    delete next.name;
    delete next.description;
    return Object.keys(next).length > 0 ? JSON.stringify(next, null, 2) : "";
  } catch {
    return content;
  }
}

function stripInstalledSkillPreviewMetadata(content: string, skill: SkillSummary) {
  if (/\.(md|mdx|markdown)$/i.test(skill.skillFile)) {
    return stripMarkdownSkillMetadata(content, skill);
  }
  if (/\.json$/i.test(skill.skillFile)) {
    return stripJsonSkillMetadata(content);
  }
  return content;
}

export function InstalledSkillPreviewDrawer(props: {
  skill: SkillSummary;
  preview: InstalledSkillPreviewState;
  checked: boolean;
  skillsEnabled: boolean;
  onClose: () => void;
}) {
  const { skill, preview, checked, skillsEnabled, onClose } = props;
  const { t } = useLocale();
  const alwaysEnabled = isAlwaysEnabledSkillName(skill.name);
  const source = skill.source;
  const description = skill.description.trim();
  const previewIsMarkdown = /\.(md|mdx|markdown)$/i.test(skill.skillFile);
  const previewContent = stripInstalledSkillPreviewMetadata(preview.content, skill);
  const statusLabel = alwaysEnabled
    ? t("settings.skillsInstalledPreviewBuiltIn")
    : checked
      ? t("settings.skillsInstalledPreviewSelected")
      : t("settings.skillsInstalledPreviewUnselected");

  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 200);
  }, [closing, onClose]);

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-end bg-background/55",
        closing ? "skills-drawer-backdrop-closing" : "skills-drawer-backdrop",
      )}
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
    >
      <aside
        className={cn(
          "flex h-full w-full flex-col border-l border-border/45 bg-background shadow-[-18px_0_45px_-28px_rgba(15,23,42,0.45)] dark:border-white/[0.08] dark:bg-popover dark:shadow-[-18px_0_45px_-28px_rgba(0,0,0,0.7)] md:w-2/5 md:max-w-[34rem]",
          closing ? "skills-drawer-panel-closing" : "skills-drawer-panel",
        )}
      >
        <div className="flex items-start gap-3 border-b border-border/40 px-5 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]">
            {alwaysEnabled ? <Lock className="h-5 w-5" /> : <SkillIcon className="h-7 w-7" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {t("settings.skillsInstalledPreviewTitle")}
            </div>
            <h2 className="mt-1 truncate text-base font-semibold tracking-tight text-foreground">
              {skill.name}
            </h2>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1",
                  alwaysEnabled
                    ? "bg-foreground/[0.06] text-foreground/75 ring-border/45"
                    : checked
                      ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                      : "bg-muted/45 text-muted-foreground ring-border/35",
                )}
              >
                {statusLabel}
              </span>
              {source?.version ? <span>v{source.version}</span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            title={t("settings.cronViewClose")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3">
              <div className="rounded-2xl border border-border/40 bg-background/70 p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.07] dark:bg-white/[0.05] dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/45 bg-background/80 text-foreground/75">
                    <SkillIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {t("settings.skillsInstalledPreviewName")}
                    </div>
                    <div className="mt-1 break-words text-[15px] font-semibold leading-snug text-foreground">
                      {skill.name}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/40 bg-background/60 p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset] dark:border-white/[0.06] dark:bg-white/[0.04] dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted/35 text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {t("settings.skillsInstalledPreviewDescription")}
                    </div>
                    <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
                      {description || t("settings.skillsInstalledPreviewNoDescription")}
                    </p>
                    <div className="mt-2 flex justify-end">
                      <SkillPreviewCopyButton
                        value={description}
                        label={t("settings.skillsInstalledPreviewCopyDescription")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {!skillsEnabled ? (
              <div className="rounded-2xl border border-border/40 bg-muted/35 p-3">
                <div className="flex items-start gap-2 text-[12px] text-muted-foreground">
                  <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/65" />
                  <span>{t("settings.skillsDisabledHint")}</span>
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/40 bg-background/60 p-3">
              <div className="mb-2 text-[12px] font-semibold text-foreground">
                {t("settings.skillsInstalledPreviewDetails")}
              </div>
              <div className="divide-y divide-border/30">
                <InstalledPreviewField
                  label={t("settings.skillsInstalledPreviewBaseDir")}
                  value={skill.baseDir}
                />
                <InstalledPreviewField
                  label={t("settings.skillsInstalledPreviewSkillFile")}
                  value={skill.skillFile}
                />
                <InstalledPreviewField
                  label={t("settings.skillsInstalledPreviewSource")}
                  value={source?.registry}
                />
                <InstalledPreviewField
                  label={t("settings.skillsStorePreviewSlug")}
                  value={source?.slug}
                />
                <InstalledPreviewField
                  label={t("settings.skillsStorePreviewVersion")}
                  value={source?.version}
                />
                <InstalledPreviewField
                  label={t("settings.skillsInstalledPreviewPublished")}
                  value={
                    source?.publishedAt ? formatInstalledPreviewDate(source.publishedAt) : null
                  }
                />
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-background/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[12px] font-semibold text-foreground">
                  {t("settings.skillsInstalledPreviewFilePreview")}
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <div className="truncate text-[10.5px] text-muted-foreground/70">
                    {preview.skillFile || skill.skillFile}
                  </div>
                  <SkillPreviewCopyButton
                    value={previewContent}
                    label={t("settings.skillsInstalledPreviewCopyFile")}
                  />
                </div>
              </div>

              {preview.loading ? (
                <InstalledPreviewSkeleton />
              ) : (
                <>
                  {preview.error ? (
                    <div className="rounded-xl border border-border/35 bg-muted/35 p-3">
                      <div className="flex items-start gap-2 text-[12px] text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/65" />
                        <div className="min-w-0">
                          <div>{t("settings.skillsInstalledPreviewUnavailable")}</div>
                          <div className="mt-1 break-words text-[11px] opacity-75">
                            {preview.error}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {previewContent ? (
                    previewIsMarkdown ? (
                      <Markdown
                        content={previewContent}
                        className="text-[12px] leading-5 text-muted-foreground"
                      />
                    ) : (
                      <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/35 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                        {previewContent}
                      </pre>
                    )
                  ) : preview.error ? null : (
                    <div className="rounded-xl border border-border/35 bg-muted/30 p-3 text-[12px] text-muted-foreground">
                      {t("settings.skillsInstalledPreviewEmpty")}
                    </div>
                  )}

                  {preview.truncated ? (
                    <div className="mt-2 rounded-xl border border-border/35 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                      {t("settings.skillsInstalledPreviewTruncated").replace(
                        "{count}",
                        String(INSTALLED_SKILL_PREVIEW_LINES),
                      )}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function InstalledPreviewField(props: { label: string; value?: string | null }) {
  if (!props.value) return null;
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 text-[12px]">
      <div className="text-muted-foreground">{props.label}</div>
      <div className="min-w-0 break-words text-foreground">{props.value}</div>
    </div>
  );
}

function formatInstalledPreviewDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function SkillPreviewCopyButton(props: { value: string; label: string }) {
  const { value, label } = props;
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!value || !(await copyText(value))) return;
    setCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  }, [value]);

  const accessibleLabel = copied ? t("settings.skillsInstalledPreviewCopied") : label;

  return (
    <button
      type="button"
      disabled={!value}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-35"
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function InstalledPreviewSkeleton() {
  return (
    <div className="space-y-2">
      <div className="skills-skeleton-pulse h-2.5 w-full rounded-full" />
      <div className="skills-skeleton-pulse h-2.5 w-11/12 rounded-full" />
      <div className="skills-skeleton-pulse h-2.5 w-4/5 rounded-full" />
      <div className="skills-skeleton-pulse h-2.5 w-2/3 rounded-full" />
    </div>
  );
}
