import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { parseSilentMemoryProtocol } = loader.loadModule("src/lib/chat/memory/memoryProtocol.ts");

const VALID_OUTPUT = [
  "```json silent-memory-block-1-identify",
  '{ "items": [ { "fact": "用户偏好中文", "quote": "以后默认用中文回答", "type": "user", "has_signal_word": true } ] }',
  "```",
  "",
  "```json silent-memory-block-2-match",
  '{ "items": [ { "fact_index": 0, "decision": "NEW", "slug": "user-language", "reason": "first time" } ] }',
  "```",
  "",
  "```json silent-memory-block-3-plan",
  '{ "items": [ { "action": "write", "slug": "user-language", "scope": "global", "type": "feedback", "description": "用户偏好中文回答", "body": "用户希望默认用中文回答。", "confidence": "high", "source_quote": "以后默认用中文回答", "reasoning": "explicit signal", "supersedes": null, "conflicts_with": null } ] }',
  "```",
  "",
  "```text silent-memory-block-4-emit",
  "记忆整理完成。",
  "```",
].join("\n");

test("parses a well-formed four-block output", () => {
  const result = parseSilentMemoryProtocol(VALID_OUTPUT);
  assert.equal(result.ok, true);
  assert.equal(result.parseFailed, false);
  assert.equal(result.blocks.identify.items.length, 1);
  assert.equal(result.blocks.match.items[0].decision, "NEW");
  assert.equal(result.blocks.plan.items[0].slug, "user-language");
  assert.match(result.blocks.emit.text, /记忆整理完成/);
});

test("accepts an explicit noop with empty items arrays", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [] }',
    "```",
    "```text silent-memory-block-4-emit",
    "本轮无需更新记忆。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, true);
  assert.equal(result.blocks.identify.items.length, 0);
});

test("accepts confidence-only update plans", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "用户复述专业", "quote": "我是计算机专业学生", "type": "user", "has_signal_word": false } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "UPDATE", "slug": "user-major", "reason": "strengthens existing hypothesis" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [ { "action": "update", "slug": "user-major", "scope": "global", "mode": "merge", "confidence": "medium", "source_quote": "我是计算机专业学生", "reasoning": "用户在当前轮次自然复述了专业信息" } ] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, true);
  assert.equal(result.blocks.plan.items[0].confidence, "medium");
  assert.equal(result.blocks.plan.items[0].body, undefined);
});

test("accepts review promotion plans", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "用户确认自己是计算机专业学生", "quote": "对", "type": "user", "has_signal_word": false } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "ACCEPT", "slug": "user-major", "reason": "user confirmed existing unreviewed memory" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [ { "action": "accept", "slug": "user-major", "scope": "global" } ] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, true);
  assert.equal(result.blocks.match.items[0].decision, "ACCEPT");
  assert.equal(result.blocks.plan.items[0].action, "accept");
});

test("accepts correction plans that update and then accept the same unreviewed slug", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "用户纠正专业信息", "quote": "不是计算机，是软件工程", "type": "user", "has_signal_word": false } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "UPDATE", "slug": "user-major", "reason": "corrects existing unreviewed memory" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [ { "action": "update", "slug": "user-major", "scope": "global", "mode": "merge", "body": "用户是软件工程专业学生。", "confidence": "medium", "source_quote": "不是计算机，是软件工程", "reasoning": "用户纠正了此前专业信息" }, { "action": "accept", "slug": "user-major", "scope": "global" } ] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, true);
  assert.equal(result.blocks.plan.items.length, 2);
  assert.equal(result.blocks.plan.items[0].action, "update");
  assert.equal(result.blocks.plan.items[1].action, "accept");
});

test("rejects extra plan items for unmatched slugs", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "用户确认专业信息", "quote": "对", "type": "user", "has_signal_word": false } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "ACCEPT", "slug": "user-major", "reason": "confirmed unreviewed memory" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [ { "action": "accept", "slug": "user-major", "scope": "global" }, { "action": "delete", "slug": "unrelated-memory", "scope": "global" } ] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /plan item for unmatched slug unrelated-memory/);
});

test("rejects plan items that target a different slug than their actionable match", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "用户确认专业信息", "quote": "对", "type": "user", "has_signal_word": false } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "ACCEPT", "slug": "user-major", "reason": "confirmed unreviewed memory" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [ { "action": "accept", "slug": "unrelated-memory", "scope": "global" } ] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /plan item for unmatched slug unrelated-memory/);
});

test("rejects actionable slugs that are not covered by any plan item", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "用户确认专业信息", "quote": "对", "type": "user", "has_signal_word": false }, { "fact": "用户确认语言偏好", "quote": "对，也用中文", "type": "feedback", "has_signal_word": false } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "ACCEPT", "slug": "user-major", "reason": "confirmed unreviewed memory" }, { "fact_index": 1, "decision": "ACCEPT", "slug": "user-language", "reason": "confirmed unreviewed memory" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [ { "action": "accept", "slug": "user-major", "scope": "global" }, { "action": "update", "slug": "user-major", "scope": "global", "mode": "merge", "confidence": "medium", "source_quote": "对", "reasoning": "current user confirmation" } ] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /actionable slug user-language has no block-3 plan item/);
});

test("rejects actionable match items without a slug", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "用户确认专业信息", "quote": "对", "type": "user", "has_signal_word": false } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "ACCEPT", "slug": "", "reason": "confirmed unreviewed memory" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [ { "action": "accept", "slug": "user-major", "scope": "global" } ] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /ACCEPT is missing slug/);
});

test("rejects output missing block-2", () => {
  const broken = VALID_OUTPUT.replace(/```json silent-memory-block-2-match[\s\S]*?```/, "");
  const result = parseSilentMemoryProtocol(broken);
  assert.equal(result.ok, false);
  assert.equal(result.parseFailed, true);
  assert.match(result.reason, /block-2-match/);
});

test("rejects malformed JSON inside a block", () => {
  const broken = VALID_OUTPUT.replace(
    '{ "items": [ { "fact_index": 0, "decision": "NEW", "slug": "user-language", "reason": "first time" } ] }',
    '{ "items": [ { "fact_index": 0, "decision": "NEW" ',
  );
  const result = parseSilentMemoryProtocol(broken);
  assert.equal(result.ok, false);
  assert.equal(result.parseFailed, true);
  assert.match(result.reason, /block-2 JSON/);
});

test("rejects when block-1 and block-2 item counts mismatch", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "a", "quote": "a", "type": "user", "has_signal_word": true }, { "fact": "b", "quote": "b", "type": "user", "has_signal_word": true } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "NEW", "slug": "x", "reason": "y" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /block-1 has 2 items but block-2 has 1/);
});

test("rejects when block-3 plan has fewer actionable items than block-2 decisions", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    '{ "items": [ { "fact": "a", "quote": "a", "type": "user", "has_signal_word": true } ] }',
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [ { "fact_index": 0, "decision": "NEW", "slug": "x", "reason": "y" } ] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [] }',
    "```",
    "```text silent-memory-block-4-emit",
    "记忆整理完成。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /actionable items but block-3 emitted 0/);
});

test("rejects when block items field is missing", () => {
  const text = [
    "```json silent-memory-block-1-identify",
    "{ }",
    "```",
    "```json silent-memory-block-2-match",
    '{ "items": [] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [] }',
    "```",
    "```text silent-memory-block-4-emit",
    "本轮无需更新记忆。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /block-1 JSON: block has no items array/);
});

test("rejects blocks emitted out of order", () => {
  const text = [
    "```json silent-memory-block-2-match",
    '{ "items": [] }',
    "```",
    "```json silent-memory-block-1-identify",
    '{ "items": [] }',
    "```",
    "```json silent-memory-block-3-plan",
    '{ "items": [] }',
    "```",
    "```text silent-memory-block-4-emit",
    "本轮无需更新记忆。",
    "```",
  ].join("\n");
  const result = parseSilentMemoryProtocol(text);
  assert.equal(result.ok, false);
  assert.match(result.reason, /not in required order/);
});

test("rejects write plans missing durable write fields", () => {
  const broken = VALID_OUTPUT.replace(
    '"description": "用户偏好中文回答", "body": "用户希望默认用中文回答。", ',
    "",
  );
  const result = parseSilentMemoryProtocol(broken);
  assert.equal(result.ok, false);
  assert.match(result.reason, /write is missing description/);
});
