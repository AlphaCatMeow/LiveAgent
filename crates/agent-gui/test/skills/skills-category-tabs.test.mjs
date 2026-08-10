import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlsSource = readFileSync(
  new URL("../../../agent-ui/src/pages/skills-hub/SkillCategoryControls.tsx", import.meta.url),
  "utf8",
);
const hubSource = readFileSync(
  new URL("../../../agent-ui/src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
  "utf8",
);

test("skill category navigation uses the shared standard Tabs components", () => {
  assert.match(controlsSource, /import \{ Tabs, TabsList, TabsTrigger \}/);
  assert.match(controlsSource, /<Tabs[\s\S]*<TabsList[\s\S]*<TabsTrigger/);
  assert.doesNotMatch(controlsSource, /ToggleGroup/);
});

test("installed skill categories use compact outlined tabs without icons", () => {
  assert.match(
    hubSource,
    /<StoreCategoryChips[\s\S]*appearance="outlined"[\s\S]*showIcons=\{false\}/,
  );
  assert.match(controlsSource, /appearance === "outlined"/);
  assert.match(controlsSource, /showIcons \? <CategoryIcon/);
  assert.match(controlsSource, /<Badge[\s\S]*h-4 min-w-4 rounded-full px-1/);
  assert.match(controlsSource, /h-7 shrink-0 gap-1 rounded-md px-2/);
});
