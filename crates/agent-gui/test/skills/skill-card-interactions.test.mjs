import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const uiRoot = new URL("../../../agent-ui/src/", import.meta.url);

function readUiSource(path) {
  return readFileSync(new URL(path, uiRoot), "utf8");
}

test("installed Skill card actions do not bubble into the card preview trigger", () => {
  const source = readUiSource("pages/skills-hub/InstalledSkillCard.tsx");

  assert.match(source, /data-card-action-zone=""/);
  assert.match(source, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /<ResourceActivationSwitch[\s\S]*stopPropagation/);
});

test("resource switches isolate pointer, mouse, click, and keyboard events when requested", () => {
  const source = readUiSource("components/resources/ResourceActivationSwitch.tsx");

  assert.match(source, /if \(props\.stopPropagation\) event\.stopPropagation\(\)/);
  assert.match(source, /onPointerDown=\{stopEventPropagation\}/);
  assert.match(source, /onMouseDown=\{stopEventPropagation\}/);
  assert.match(source, /onKeyDown=\{stopEventPropagation\}/);
  assert.match(source, /onClick=\{\(event\) => \{[\s\S]*stopEventPropagation\(event\)/);
});

test("confirmation popovers isolate cancel and confirm actions from parent cards", () => {
  const source = readUiSource("components/ui/confirm-action-popover.tsx");

  assert.match(source, /<Popover\.Popup[\s\S]*onPointerDown=.*stopPropagation/);
  assert.match(source, /<Popover\.Popup[\s\S]*onClick=.*stopPropagation/);
  assert.match(
    source,
    /variant="outline"[\s\S]*onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
  );
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*onConfirm\(\);/);
});
