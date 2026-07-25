import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createTranscriptMeasurementsLru } = loader.loadModule(
  "src/lib/transcript-virtual/measurementsLru.ts",
);
const transcriptListSource = readFileSync(
  new URL("../../src/pages/chat/transcript/TranscriptList.tsx", import.meta.url),
  "utf8",
);
const transcriptWidthControlsSource = readFileSync(
  new URL("../../src/pages/chat/transcript/TranscriptWidthControls.tsx", import.meta.url),
  "utf8",
);
const scrollFollowSource = readFileSync(
  new URL("../../src/lib/chat-scroll/useScrollFollow.ts", import.meta.url),
  "utf8",
);

const item = (key, size) => ({ index: 0, key, start: 0, size, end: size, lane: 0 });

const layoutKey = (viewportWidth, contentWidth) => `${viewportWidth}:${contentWidth}`;

test("width changes keep ResizeObserver measurements instead of clearing them", () => {
  assert.doesNotMatch(transcriptListSource, /^\s*virtualizer\.measure\(\);/m);
  assert.match(transcriptListSource, /\$\{scrollViewport\.clientWidth\}:\$\{layoutWidth\}/);
});

test("keyboard width controls do not detach transcript scroll follow", () => {
  assert.match(transcriptWidthControlsSource, /data-scroll-follow-ignore-keys/);
  assert.match(scrollFollowSource, /closest\("\[data-scroll-follow-ignore-keys\]"\)/);
});

test("save/restore round-trips measurements at the same layout width", () => {
  const lru = createTranscriptMeasurementsLru();
  const measurements = [item("a", 120), item("b", 300)];
  lru.save("conv-1", layoutKey(800, 768), measurements);
  assert.equal(lru.restore("conv-1", layoutKey(800, 768)), measurements);
});

test("restore is layout-gated and misses unknown conversations", () => {
  const lru = createTranscriptMeasurementsLru();
  lru.save("conv-1", layoutKey(800, 768), [item("a", 120)]);
  assert.equal(lru.restore("conv-1", layoutKey(900, 768)), null);
  assert.equal(lru.restore("conv-1", layoutKey(800, 960)), null);
  assert.equal(lru.restore("conv-2", layoutKey(800, 768)), null);
});

test("empty snapshots, blank ids, and blank layout keys are not stored", () => {
  const lru = createTranscriptMeasurementsLru();
  lru.save("conv-1", layoutKey(800, 768), []);
  lru.save("", layoutKey(800, 768), [item("a", 120)]);
  lru.save("conv-2", "", [item("a", 120)]);
  assert.equal(lru.restore("conv-1", layoutKey(800, 768)), null);
  assert.equal(lru.restore("", layoutKey(800, 768)), null);
  assert.equal(lru.restore("conv-2", ""), null);
});

test("capacity evicts the least recently used entry", () => {
  const lru = createTranscriptMeasurementsLru(2);
  lru.save("conv-1", layoutKey(800, 768), [item("a", 1)]);
  lru.save("conv-2", layoutKey(800, 768), [item("b", 2)]);
  // Touch conv-1 so conv-2 becomes the eviction candidate.
  assert.ok(lru.restore("conv-1", layoutKey(800, 768)));
  lru.save("conv-3", layoutKey(800, 768), [item("c", 3)]);
  assert.ok(lru.restore("conv-1", layoutKey(800, 768)));
  assert.equal(lru.restore("conv-2", layoutKey(800, 768)), null);
  assert.ok(lru.restore("conv-3", layoutKey(800, 768)));
});

test("re-saving a conversation replaces its snapshot", () => {
  const lru = createTranscriptMeasurementsLru();
  lru.save("conv-1", layoutKey(800, 768), [item("a", 1)]);
  const next = [item("a", 2)];
  lru.save("conv-1", layoutKey(820, 960), next);
  assert.equal(lru.restore("conv-1", layoutKey(800, 768)), null);
  assert.equal(lru.restore("conv-1", layoutKey(820, 960)), next);
});
