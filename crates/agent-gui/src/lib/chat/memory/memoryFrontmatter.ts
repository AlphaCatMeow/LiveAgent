/**
 * Tolerant parser for the evidence frontmatter that `evidenceBody` (memoryTools.ts)
 * prepends to write/update bodies.
 *
 * The spec (doc/memory/gui-memory-precision-analysis.md §4.1.1) calls for a
 * 4-layer fallback so an occasional formatting mistake by the model does not
 * silently lose the evidence chain:
 *
 *   1. Strict YAML between `---` / `---` fences.
 *   2. Fenced ```yaml ... ``` block.
 *   3. Inline key/value scan over the first 20 lines.
 *   4. parse_failed = true with empty values, so callers can flag the entry.
 *
 * The parser is intentionally string-based: we only recognise a small fixed
 * set of keys, avoid pulling in a YAML dependency, and return a typed result
 * regardless of which fallback fired. Future consumers (Reviewer Pass UI
 * badges, Decisions Tab) read `parseFailed` / `usedFallback` for telemetry.
 */

export type MemoryConfidence = "high" | "medium" | "low" | "unknown";

export type MemoryEvidenceFrontmatter = {
  confidence: MemoryConfidence;
  sourceQuote: string;
  reasoning: string;
  aliases: string[];
  conflictsWith: string[];
  supersedes: string;
  overrideReject: string;
  autoDowngraded: boolean;
};

export type MemoryFrontmatterParseResult = {
  frontmatter: MemoryEvidenceFrontmatter;
  body: string;
  usedFallback: "strict" | "fenced" | "inline" | "none";
  parseFailed: boolean;
};

const EMPTY_FRONTMATTER: MemoryEvidenceFrontmatter = {
  confidence: "unknown",
  sourceQuote: "",
  reasoning: "",
  aliases: [],
  conflictsWith: [],
  supersedes: "",
  overrideReject: "",
  autoDowngraded: false,
};

const STRICT_FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FENCED_YAML = /^```(?:yaml|yml)\s*\r?\n([\s\S]*?)\r?\n```\r?\n?/i;
const INLINE_SCAN_LINE_LIMIT = 20;

const CONFIDENCE_VALUES: ReadonlySet<MemoryConfidence> = new Set([
  "high",
  "medium",
  "low",
  "unknown",
]);

function asConfidence(raw: string): MemoryConfidence {
  const trimmed = raw.trim().toLowerCase();
  return CONFIDENCE_VALUES.has(trimmed as MemoryConfidence)
    ? (trimmed as MemoryConfidence)
    : "unknown";
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
  }
  return trimmed;
}

function parseArrayLiteral(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1);
    return inner
      .split(",")
      .map((part) => stripQuotes(part))
      .filter((part) => part.length > 0);
  }
  // tolerate comma-separated unbracketed lists for inline-scan fallback
  return trimmed
    .split(",")
    .map((part) => stripQuotes(part))
    .filter((part) => part.length > 0);
}

function parseBoolean(value: string): boolean {
  const lowered = value.trim().toLowerCase();
  return lowered === "true" || lowered === "yes" || lowered === "1";
}

function applyKeyValue(out: MemoryEvidenceFrontmatter, key: string, rawValue: string): void {
  const value = rawValue.trim();
  switch (key) {
    case "confidence":
      out.confidence = asConfidence(value);
      break;
    case "source_quote":
      out.sourceQuote = stripQuotes(value);
      break;
    case "reasoning":
      out.reasoning = stripQuotes(value);
      break;
    case "aliases":
      out.aliases = parseArrayLiteral(value);
      break;
    case "conflicts_with":
      out.conflictsWith = parseArrayLiteral(value);
      break;
    case "supersedes":
      out.supersedes = stripQuotes(value);
      break;
    case "override_reject":
      out.overrideReject = stripQuotes(value);
      break;
    case "auto_downgraded":
      out.autoDowngraded = parseBoolean(value);
      break;
    default:
      // ignore unknown keys; the parser stays additive
      break;
  }
}

function parseKeyValueBlock(block: string): MemoryEvidenceFrontmatter {
  const out: MemoryEvidenceFrontmatter = {
    ...EMPTY_FRONTMATTER,
    aliases: [],
    conflictsWith: [],
  };
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1);
    applyKeyValue(out, key, value);
  }
  return out;
}

function scanInline(body: string): MemoryEvidenceFrontmatter | null {
  const lines = body.split(/\r?\n/).slice(0, INLINE_SCAN_LINE_LIMIT);
  const out: MemoryEvidenceFrontmatter = {
    ...EMPTY_FRONTMATTER,
    aliases: [],
    conflictsWith: [],
  };
  let found = false;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex <= 0) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1);
    if (
      key === "confidence" ||
      key === "source_quote" ||
      key === "reasoning" ||
      key === "aliases" ||
      key === "conflicts_with" ||
      key === "supersedes" ||
      key === "override_reject" ||
      key === "auto_downgraded"
    ) {
      applyKeyValue(out, key, value);
      found = true;
    }
  }
  return found ? out : null;
}

export function parseMemoryFrontmatter(body: string): MemoryFrontmatterParseResult {
  if (!body) {
    return {
      frontmatter: { ...EMPTY_FRONTMATTER, aliases: [], conflictsWith: [] },
      body: "",
      usedFallback: "none",
      parseFailed: false,
    };
  }
  const stripped = body.replace(/^﻿/, "");

  const strict = STRICT_FENCE.exec(stripped);
  if (strict) {
    const frontmatter = parseKeyValueBlock(strict[1]);
    return {
      frontmatter,
      body: stripped.slice(strict[0].length).replace(/^\r?\n/, ""),
      usedFallback: "strict",
      parseFailed: false,
    };
  }

  const fenced = FENCED_YAML.exec(stripped);
  if (fenced) {
    const frontmatter = parseKeyValueBlock(fenced[1]);
    return {
      frontmatter,
      body: stripped.slice(fenced[0].length).replace(/^\r?\n/, ""),
      usedFallback: "fenced",
      parseFailed: false,
    };
  }

  const inline = scanInline(stripped);
  if (inline) {
    return {
      frontmatter: inline,
      body: stripped,
      usedFallback: "inline",
      parseFailed: false,
    };
  }

  return {
    frontmatter: { ...EMPTY_FRONTMATTER, aliases: [], conflictsWith: [] },
    body: stripped,
    usedFallback: "none",
    parseFailed: true,
  };
}
