import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { parseMemoryFrontmatter } = loader.loadModule("src/lib/chat/memory/memoryFrontmatter.ts");

test("strict YAML fence parses confidence + source_quote and isolates body", () => {
  const body = [
    "---",
    'confidence: high',
    'source_quote: "以后默认用中文回答"',
    'reasoning: "explicit signal"',
    'aliases: ["中文", "Chinese"]',
    'conflicts_with: []',
    'supersedes: ""',
    'override_reject: ""',
    "---",
    "",
    "默认使用中文回答。",
  ].join("\n");
  const r = parseMemoryFrontmatter(body);
  assert.equal(r.usedFallback, "strict");
  assert.equal(r.parseFailed, false);
  assert.equal(r.frontmatter.confidence, "high");
  assert.equal(r.frontmatter.sourceQuote, "以后默认用中文回答");
  assert.equal(r.frontmatter.reasoning, "explicit signal");
  assert.deepEqual(r.frontmatter.aliases, ["中文", "Chinese"]);
  assert.deepEqual(r.frontmatter.conflictsWith, []);
  assert.equal(r.body, "默认使用中文回答。");
});

test("strict YAML carries auto_downgraded flag through", () => {
  const body = [
    "---",
    "confidence: medium",
    "auto_downgraded: true",
    'source_quote: ""',
    "---",
    "",
    "用户偏好中文",
  ].join("\n");
  const r = parseMemoryFrontmatter(body);
  assert.equal(r.usedFallback, "strict");
  assert.equal(r.frontmatter.confidence, "medium");
  assert.equal(r.frontmatter.autoDowngraded, true);
  assert.equal(r.body, "用户偏好中文");
});

test("fenced ```yaml block is parsed as fallback layer 2", () => {
  const body = [
    "```yaml",
    "confidence: low",
    'source_quote: "我猜"',
    "```",
    "",
    "fact body here",
  ].join("\n");
  const r = parseMemoryFrontmatter(body);
  assert.equal(r.usedFallback, "fenced");
  assert.equal(r.parseFailed, false);
  assert.equal(r.frontmatter.confidence, "low");
  assert.equal(r.frontmatter.sourceQuote, "我猜");
  assert.equal(r.body, "fact body here");
});

test("inline key/value scan is the third fallback layer", () => {
  const body = [
    "Some body intro line",
    'confidence: medium',
    'source_quote: "我以后用 vim"',
    "more body content",
  ].join("\n");
  const r = parseMemoryFrontmatter(body);
  assert.equal(r.usedFallback, "inline");
  assert.equal(r.parseFailed, false);
  assert.equal(r.frontmatter.confidence, "medium");
  assert.equal(r.frontmatter.sourceQuote, "我以后用 vim");
});

test("inline scan ignores keys after the 20-line cap", () => {
  const padding = Array.from({ length: 25 }, (_, i) => `line ${i}`);
  padding.push("confidence: high");
  const r = parseMemoryFrontmatter(padding.join("\n"));
  assert.equal(r.parseFailed, true);
  assert.equal(r.usedFallback, "none");
});

test("returns parse_failed=true for body without any evidence markers", () => {
  const r = parseMemoryFrontmatter("just a plain note\nwithout frontmatter");
  assert.equal(r.usedFallback, "none");
  assert.equal(r.parseFailed, true);
  assert.equal(r.frontmatter.confidence, "unknown");
  assert.equal(r.frontmatter.sourceQuote, "");
  assert.deepEqual(r.frontmatter.aliases, []);
});

test("empty body short-circuits with no parse failure flag", () => {
  const r = parseMemoryFrontmatter("");
  assert.equal(r.parseFailed, false);
  assert.equal(r.usedFallback, "none");
  assert.equal(r.body, "");
});

test("unknown confidence value falls back to 'unknown'", () => {
  const body = ["---", "confidence: very-high", "---", "", "body"].join("\n");
  const r = parseMemoryFrontmatter(body);
  assert.equal(r.frontmatter.confidence, "unknown");
});

test("aliases tolerate unbracketed comma-separated inline scan", () => {
  const body = [
    "leading line",
    "confidence: low",
    "aliases: vim, neovim, vi",
    "trailing body",
  ].join("\n");
  const r = parseMemoryFrontmatter(body);
  assert.equal(r.usedFallback, "inline");
  assert.deepEqual(r.frontmatter.aliases, ["vim", "neovim", "vi"]);
});
