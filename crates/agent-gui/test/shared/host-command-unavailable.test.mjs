import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { isHostCommandUnavailable } = loader.loadModule(
  "../agent-ui/src/lib/shared/hostErrors.ts",
);

test("recognises both hosts that lack a desktop command", () => {
  assert.equal(
    isHostCommandUnavailable(
      new Error("Tauri command terminal_create is unavailable in K-brain browser mode"),
    ),
    true,
  );
  assert.equal(
    isHostCommandUnavailable(new Error("Desktop runtime command checkpoint_list is unavailable in K-brain mode; use the K-brain backend capability.")),
    true,
  );
  assert.equal(
    isHostCommandUnavailable('WebUI shim does not implement invoke("git_branches")'),
    true,
  );
});

test("real failures keep passing through", () => {
  assert.equal(isHostCommandUnavailable(new Error("git: not a repository")), false);
  assert.equal(isHostCommandUnavailable(new Error("permission denied")), false);
  assert.equal(isHostCommandUnavailable(undefined), false);
  assert.equal(isHostCommandUnavailable(null), false);
});

test("branch selector swaps the host message for a localised hint", () => {
  const source = readFileSync(
    new URL("../../../agent-ui/src/components/git/GitBranchSelector.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /isHostCommandUnavailable\(err\)/);
  assert.match(source, /"git\.branchSelector\.runtimeUnsupported"/);

  const zh = readFileSync(
    new URL("../../../agent-ui/src/i18n/translations/zhCNCommon.ts", import.meta.url),
    "utf8",
  );
  const en = readFileSync(
    new URL("../../../agent-ui/src/i18n/translations/enUSCommon.ts", import.meta.url),
    "utf8",
  );
  assert.match(zh, /"git\.branchSelector\.runtimeUnsupported":\s*\n?\s*"[^"]*桌面 Git 能力/);
  assert.match(en, /"git\.branchSelector\.runtimeUnsupported":\s*\n?\s*"[^"]*desktop Git/);
});
