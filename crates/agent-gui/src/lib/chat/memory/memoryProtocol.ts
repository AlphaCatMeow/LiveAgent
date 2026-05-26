/**
 * Parser for the Silent Memory Extraction Four-block Output Protocol.
 *
 * The silent post-turn LLM is instructed to emit four fenced blocks named
 * `silent-memory-block-{1-identify,2-match,3-plan,4-emit}` in order. This
 * module parses that output and validates structural consistency. PR-5 wires
 * it in observability-only mode: parse failures are logged but tool calls are
 * not rejected. A later iteration can promote failures to hard rejection.
 */

export type SilentMemoryBlockIdentifyItem = {
  fact?: unknown;
  quote?: unknown;
  type?: unknown;
  has_signal_word?: unknown;
};

export type SilentMemoryBlockMatchItem = {
  fact_index?: unknown;
  decision?: unknown;
  slug?: unknown;
  reason?: unknown;
};

export type SilentMemoryBlockPlanItem = {
  action?: unknown;
  slug?: unknown;
  scope?: unknown;
  type?: unknown;
  description?: unknown;
  body?: unknown;
  mode?: unknown;
  confidence?: unknown;
  source_quote?: unknown;
  reasoning?: unknown;
  supersedes?: unknown;
  conflicts_with?: unknown;
  override_reject?: unknown;
};

export type SilentMemoryParseResult = {
  ok: boolean;
  parseFailed: boolean;
  reason?: string;
  blocks: {
    identify?: { items: SilentMemoryBlockIdentifyItem[] };
    match?: { items: SilentMemoryBlockMatchItem[] };
    plan?: { items: SilentMemoryBlockPlanItem[] };
    emit?: { text: string };
  };
};

const BLOCK_NAMES = [
  "silent-memory-block-1-identify",
  "silent-memory-block-2-match",
  "silent-memory-block-3-plan",
  "silent-memory-block-4-emit",
] as const;

type BlockName = (typeof BLOCK_NAMES)[number];

type ExtractedBlock = {
  raw: string;
  index: number;
};

function extractBlock(text: string, name: BlockName): ExtractedBlock | null {
  const pattern = new RegExp(
    "```\\s*\\w*\\s+" + name.replace(/[-]/g, "\\-") + "\\s*\\n([\\s\\S]*?)\\n```",
    "i",
  );
  const match = pattern.exec(text);
  return match?.index === undefined ? null : { raw: match[1], index: match.index };
}

function tryParseJsonItems(raw: string): { items?: unknown[]; error?: string } {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "block JSON is not an object" };
    }
    const items = (parsed as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      return { error: "block has no items array" };
    }
    return { items };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateMatchItems(
  items: readonly SilentMemoryBlockMatchItem[],
  identifyCount: number,
): string | null {
  const validDecisions = new Set(["NEW", "UPDATE", "ACCEPT", "DUPLICATE", "CONFLICT", "SKIP"]);
  const actionableDecisions = new Set(["NEW", "UPDATE", "ACCEPT", "CONFLICT"]);
  for (const [index, item] of items.entries()) {
    const decision = stringField(item.decision);
    if (!validDecisions.has(decision)) {
      return `block-2 item ${index} has invalid decision`;
    }
    if (!Number.isInteger(item.fact_index)) {
      return `block-2 item ${index} has invalid fact_index`;
    }
    if (actionableDecisions.has(decision) && !stringField(item.slug)) {
      return `block-2 item ${index} ${decision} is missing slug`;
    }
    const factIndex = item.fact_index as number;
    if (factIndex < 0 || factIndex >= identifyCount) {
      return `block-2 item ${index} fact_index out of range`;
    }
  }
  return null;
}

function validatePlanItems(items: readonly SilentMemoryBlockPlanItem[]): string | null {
  const validActions = new Set(["write", "update", "accept", "delete", "append-daily"]);
  const validScopes = new Set(["global", "project"]);
  const validTypes = new Set(["user", "feedback", "project", "reference"]);
  const validModes = new Set(["replace", "merge", "append", ""]);
  const validConfidence = new Set(["high", "medium", "low", ""]);

  for (const [index, item] of items.entries()) {
    const action = stringField(item.action);
    if (!validActions.has(action)) return `block-3 item ${index} has invalid action`;

    const slug = stringField(item.slug);
    if (!slug) return `block-3 item ${index} is missing slug`;

    const confidence = stringField(item.confidence);
    if (!validConfidence.has(confidence)) {
      return `block-3 item ${index} has invalid confidence`;
    }

    if (action === "write") {
      if (!validScopes.has(stringField(item.scope))) {
        return `block-3 item ${index} write is missing valid scope`;
      }
      if (!validTypes.has(stringField(item.type))) {
        return `block-3 item ${index} write is missing valid type`;
      }
      if (!stringField(item.description)) {
        return `block-3 item ${index} write is missing description`;
      }
      if (!stringField(item.body)) return `block-3 item ${index} write is missing body`;
    }

    if (action === "update") {
      const mode = stringField(item.mode);
      if (!validModes.has(mode)) return `block-3 item ${index} update has invalid mode`;
      if (mode === "append" && !slug.startsWith("daily-")) {
        return `block-3 item ${index} append update must target a daily slug`;
      }
      const hasEvidence =
        stringField(item.confidence) ||
        stringField(item.source_quote) ||
        stringField(item.reasoning);
      if (!stringField(item.body) && !stringField(item.description) && !hasEvidence) {
        return `block-3 item ${index} update needs body, description, or evidence fields`;
      }
    }

    if ((action === "accept" || action === "delete") && !validScopes.has(stringField(item.scope))) {
      return `block-3 item ${index} ${action} is missing valid scope`;
    }

    if (action === "append-daily") {
      if (!slug.startsWith("daily-")) {
        return `block-3 item ${index} append-daily must target a daily slug`;
      }
      if (!stringField(item.body)) return `block-3 item ${index} append-daily is missing body`;
    }
  }
  return null;
}

export function parseSilentMemoryProtocol(text: string): SilentMemoryParseResult {
  const blocks: SilentMemoryParseResult["blocks"] = {};

  const identifyRaw = extractBlock(text, "silent-memory-block-1-identify");
  const matchRaw = extractBlock(text, "silent-memory-block-2-match");
  const planRaw = extractBlock(text, "silent-memory-block-3-plan");
  const emitRaw = extractBlock(text, "silent-memory-block-4-emit");

  if (identifyRaw === null || matchRaw === null || planRaw === null || emitRaw === null) {
    const missing = [
      identifyRaw === null && "block-1-identify",
      matchRaw === null && "block-2-match",
      planRaw === null && "block-3-plan",
      emitRaw === null && "block-4-emit",
    ]
      .filter(Boolean)
      .join(", ");
    return {
      ok: false,
      parseFailed: true,
      reason: `missing fenced blocks: ${missing}`,
      blocks,
    };
  }

  const outOfOrder =
    identifyRaw.index >= matchRaw.index ||
    matchRaw.index >= planRaw.index ||
    planRaw.index >= emitRaw.index;
  if (outOfOrder) {
    return {
      ok: false,
      parseFailed: true,
      reason: "fenced blocks are not in required order",
      blocks,
    };
  }

  const identify = tryParseJsonItems(identifyRaw.raw);
  if (identify.error) {
    return { ok: false, parseFailed: true, reason: `block-1 JSON: ${identify.error}`, blocks };
  }
  blocks.identify = { items: identify.items as SilentMemoryBlockIdentifyItem[] };

  const matchParsed = tryParseJsonItems(matchRaw.raw);
  if (matchParsed.error) {
    return { ok: false, parseFailed: true, reason: `block-2 JSON: ${matchParsed.error}`, blocks };
  }
  blocks.match = { items: matchParsed.items as SilentMemoryBlockMatchItem[] };

  const plan = tryParseJsonItems(planRaw.raw);
  if (plan.error) {
    return { ok: false, parseFailed: true, reason: `block-3 JSON: ${plan.error}`, blocks };
  }
  blocks.plan = { items: plan.items as SilentMemoryBlockPlanItem[] };

  blocks.emit = { text: emitRaw.raw.trim() };

  const identifyCount = blocks.identify.items.length;
  const matchCount = blocks.match.items.length;
  if (identifyCount !== matchCount) {
    return {
      ok: false,
      parseFailed: true,
      reason: `block-1 has ${identifyCount} items but block-2 has ${matchCount}`,
      blocks,
    };
  }

  const matchError = validateMatchItems(blocks.match.items, identifyCount);
  if (matchError) {
    return { ok: false, parseFailed: true, reason: matchError, blocks };
  }

  const decisionsRequiringPlan = blocks.match.items.filter((item) => {
    const decision = typeof item.decision === "string" ? item.decision : "";
    return (
      decision === "NEW" ||
      decision === "UPDATE" ||
      decision === "ACCEPT" ||
      decision === "CONFLICT"
    );
  });
  const actionableSlugs = new Set(
    decisionsRequiringPlan.map((item) => stringField(item.slug)).filter((slug) => slug.length > 0),
  );
  const planCount = blocks.plan.items.length;
  if (planCount < decisionsRequiringPlan.length) {
    return {
      ok: false,
      parseFailed: true,
      reason: `block-2 marked ${decisionsRequiringPlan.length} actionable items but block-3 emitted ${planCount}`,
      blocks,
    };
  }
  const unexpectedPlan = blocks.plan.items.find((item) => {
    const slug = stringField(item.slug);
    return slug && !actionableSlugs.has(slug);
  });
  if (unexpectedPlan) {
    return {
      ok: false,
      parseFailed: true,
      reason: `block-3 emitted plan item for unmatched slug ${stringField(unexpectedPlan.slug)}`,
      blocks,
    };
  }

  const planError = validatePlanItems(blocks.plan.items);
  if (planError) {
    return { ok: false, parseFailed: true, reason: planError, blocks };
  }

  const plannedSlugs = new Set(
    blocks.plan.items.map((item) => stringField(item.slug)).filter((slug) => slug.length > 0),
  );
  const missingPlannedSlug = [...actionableSlugs].find((slug) => !plannedSlugs.has(slug));
  if (missingPlannedSlug) {
    return {
      ok: false,
      parseFailed: true,
      reason: `block-2 actionable slug ${missingPlannedSlug} has no block-3 plan item`,
      blocks,
    };
  }

  return { ok: true, parseFailed: false, blocks };
}
