import {
  type MemoryOverviewEntry,
  type MemoryOverviewResponse,
  memoryIndexOverview,
} from "../../memory/api";
import {
  buildDailyMemoryOverviewLines,
  buildMemoryOverviewIntroLines,
  MAX_MEMORY_PROMPT_CHARS,
  MEMORY_OVERVIEW_FINAL_LINE,
  MEMORY_PROMPT_TRUNCATION_SUFFIX,
} from "./memoryPolicy";

function dailyTitle(entry: MemoryOverviewEntry) {
  return entry.dateLocal || entry.slug.replace(/^daily-/, "") || entry.slug;
}

// P2-2b: compact symbols per design §4.4. The trailing bracket carries the
// minimum metadata the model needs to reason about a candidate without
// re-reading the body: id, type initial, days since updated, and an asterisk
// for unreviewed extractor entries. Keeps every line near ~32 chars instead
// of the prior ~50 chars, which is the main lever for large libraries even
// after the bucket cap.
function typeInitial(memoryType: string): string {
  switch (memoryType) {
    case "user":
      return "u";
    case "feedback":
      return "f";
    case "project":
      return "p";
    case "reference":
      return "r";
    case "daily":
      return "d";
    default:
      return "?";
  }
}

function daysAgo(updatedAt: number | undefined, nowMs: number): number {
  if (!updatedAt || !Number.isFinite(updatedAt)) return 0;
  return Math.max(0, Math.floor((nowMs - updatedAt) / 86_400_000));
}

function confidenceInitial(confidence: MemoryOverviewEntry["confidence"] | undefined): string {
  switch (confidence) {
    case "high":
      return "h";
    case "medium":
      return "m";
    case "low":
      return "l";
    default:
      return "?";
  }
}

function lineFor(entry: MemoryOverviewEntry, nowMs: number = Date.now()): string {
  const label = entry.memoryType === "daily" ? dailyTitle(entry) : entry.description;
  // (unreviewed) flag is rendered as a "*" suffix on the type initial; daily
  // entries never carry the marker because their content is append-only. For
  // unreviewed entries, append confidence as h/m/l/? so the model can calibrate
  // how directly to use the working memory while staying open to correction.
  const unreviewedFlag =
    entry.unreviewed && entry.memoryType !== "daily"
      ? `*:${confidenceInitial(entry.confidence)}`
      : "";
  const initial = typeInitial(entry.memoryType);
  const days = daysAgo(entry.updatedAt, nowMs);
  return `- ${label || "<no description>"} [${entry.slug}|${initial}${unreviewedFlag}|${days}d]`;
}

function dayLabel(dateLocal?: string | null) {
  if (!dateLocal) return "recent";
  const today = new Date();
  const date = new Date(`${dateLocal}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateLocal;
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.max(0, Math.round((todayUtc - dateUtc) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function recentDayLine(entry: MemoryOverviewEntry) {
  return `- ${dayLabel(entry.dateLocal)} [${entry.slug}|d] — journal available on demand; do not infer preferences from daily entries.`;
}

// L2 hot-candidates cap (per design §4.4): each Memory Index bucket is
// truncated after this many entries; an extra hint line tells the model how
// to recover the rest via MemoryManager. Tuned for "large library" sessions
// where global/reference entries can blow past the 16 KB prompt cap.
const MAX_INDEX_ENTRIES_PER_BUCKET = 30;

function appendSection(lines: string[], title: string, entries: MemoryOverviewEntry[]) {
  if (entries.length === 0) return;
  const nowMs = Date.now();
  const displayed = entries.slice(0, MAX_INDEX_ENTRIES_PER_BUCKET);
  const hidden = entries.length - displayed.length;
  lines.push("", title, ...displayed.map((entry) => lineFor(entry, nowMs)));
  if (hidden > 0) {
    lines.push(
      `- ... (${hidden} more entries hidden; call MemoryManager(action="list") or action="search" to retrieve)`,
    );
  }
}

export function formatMemoryOverview(overview: MemoryOverviewResponse, workdir?: string) {
  const lines = buildMemoryOverviewIntroLines();
  const reviewedUser = overview.user.filter((entry) => !entry.unreviewed);
  const unreviewedUserMemory = overview.user.filter((entry) => entry.unreviewed);

  appendSection(lines, "## User memory (cross-project identity & preferences)", reviewedUser);
  appendSection(
    lines,
    "## Unreviewed user memory (usable; auto-review via dialogue)",
    unreviewedUserMemory,
  );
  appendSection(
    lines,
    `## Project memory${workdir ? ` (workdir: ${workdir})` : ""}`,
    overview.project,
  );
  appendSection(lines, "## Global memory (cross-project facts & references)", overview.global);
  if (overview.recentDays.length > 0) {
    lines.push("", ...buildDailyMemoryOverviewLines(), ...overview.recentDays.map(recentDayLine));
  }

  lines.push("", MEMORY_OVERVIEW_FINAL_LINE);

  const text = lines.join("\n").trim();
  if (text.length <= MAX_MEMORY_PROMPT_CHARS) return text;
  return `${text.slice(0, MAX_MEMORY_PROMPT_CHARS)}\n\n${MEMORY_PROMPT_TRUNCATION_SUFFIX}`;
}

export async function buildMemoryOverviewSection(workdir?: string) {
  const overview = await memoryIndexOverview(workdir);
  const hasEntries =
    overview.user.length > 0 ||
    overview.project.length > 0 ||
    overview.global.length > 0 ||
    overview.recentDays.length > 0;
  return hasEntries ? formatMemoryOverview(overview, workdir) : "";
}
