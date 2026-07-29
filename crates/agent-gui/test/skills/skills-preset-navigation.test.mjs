import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const implementations = [
  {
    label: "GUI",
    page: new URL("../../src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
    i18n: new URL("../../src/i18n/config.ts", import.meta.url),
  },
  {
    label: "WebUI",
    page: new URL(
      "../../../agent-gateway/web/src/pages/skills-hub/SkillsHubPage.tsx",
      import.meta.url,
    ),
    i18n: new URL("../../../agent-gateway/web/src/i18n/config.ts", import.meta.url),
  },
];

for (const { label, page, i18n } of implementations) {
  const source = readFileSync(page, "utf8");
  const translations = readFileSync(i18n, "utf8");

  test(`${label} keeps Default on Installed and custom presets on their own tab`, () => {
    assert.match(source, /type SkillsHubView = "installed" \| "presets" \| "store" \| "import"/);
    assert.match(source, /value: "presets" as const,[\s\S]*settings\.skillsHubPresetsTab/);
    assert.match(
      source,
      /const activePreset =\s*view === "presets" && activeCustomPreset\s*\? activeCustomPreset\s*: defaultPreset/,
    );
    assert.match(source, /view === "presets" \? \([\s\S]*customPresets\.map/);
  });

  test(`${label} only offers installed Skills as custom preset members`, () => {
    assert.match(
      source,
      /view === "installed" \|\| view === "presets" \? \([\s\S]*sortedFiltered\.map/,
    );
    assert.match(source, /settings\.skillsPresetEditingHint/);
    assert.equal(translations.match(/"settings\.skillsPresetEditingHint":/g)?.length, 2);
  });

  test(`${label} adds newly installed store Skills to Default`, () => {
    const start = source.indexOf("  const enableInstalledSkillsFromJob = useCallback(");
    const end = source.indexOf("\n  useEffect(() => {", start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const installUpdate = source.slice(start, end);
    assert.match(
      installUpdate,
      /resolveSkillPreset\(prev\.skills, DEFAULT_SKILL_PRESET_ID\)/,
    );
    assert.doesNotMatch(installUpdate, /activePreset\.id/);
  });
}
