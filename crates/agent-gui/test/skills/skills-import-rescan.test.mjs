import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const scanState = loader.loadModule(
  "@liveagent/ui/pages/skills-hub/externalSkillScanState.ts",
);
const hubSource = readFileSync(
  new URL("../../../agent-ui/src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
  "utf8",
);
const importViewSource = readFileSync(
  new URL("../../../agent-ui/src/pages/skills-hub/SkillsImportView.tsx", import.meta.url),
  "utf8",
);

function scans(description = "A useful skill") {
  return [
    {
      tool: "codex",
      rootDir: "/tmp/codex/skills",
      exists: true,
      errors: [],
      skills: [
        {
          name: "example",
          description,
          baseDir: "/tmp/codex/skills/example",
          skillFile: "/tmp/codex/skills/example/SKILL.md",
        },
      ],
    },
  ];
}

test("unchanged external scan results preserve the current list reference", () => {
  const previous = scans();
  assert.equal(scanState.reconcileExternalToolScans(previous, scans()), previous);
  assert.notEqual(
    scanState.reconcileExternalToolScans(previous, scans("Updated description")),
    previous,
  );
});

test("manual rescans retain stale content and only mark the button busy", () => {
  assert.match(hubSource, /reconcileExternalToolScans\(previous, scans\)/);
  assert.match(hubSource, /setExternalScans\(\(previous\) => previous \?\? \[\]\)/);
  assert.match(hubSource, /initializing=\{externalScans === null\}/);
  assert.match(importViewSource, /\{initializing \? \(/);
  assert.match(importViewSource, /aria-busy=\{loading\}/);
  assert.match(importViewSource, /loading && "animate-spin"/);
  assert.doesNotMatch(importViewSource, /\{loading \? \(\s*<GlassPanel/);
  assert.doesNotMatch(importViewSource, /disabled=\{[^}]*importing \|\| loading/);
});
