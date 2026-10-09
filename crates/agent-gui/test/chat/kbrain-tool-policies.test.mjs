import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { canonicalKBrainToolPolicies, KBRAIN_POLICY_TOOL_NAMES } = loader.loadModule(
  "src/lib/kbrain/toolPolicies.ts",
);

test("frontend-only tool policies never reach K-brain run options", () => {
  // Regression: a stored `Browser: allow` from the legacy runtime made K-brain reject every run with
  // `options.tools references unavailable tool "Browser"`.
  assert.deepEqual(
    canonicalKBrainToolPolicies({
      Browser: "allow",
      McpManager: "deny",
      Agent: "ask",
      TaskCreate: "allow",
      "group:browser": "ask",
      "server:cua-driver": "allow",
      Write: "ask",
      Bash: "deny",
      Read: "allow",
    }),
    { Bash: "deny", Read: "allow", Write: "ask" },
  );
});

test("K-brain tool policies keep valid values only and are sorted", () => {
  const policies = canonicalKBrainToolPolicies({
    Grep: "allow",
    Edit: "sometimes",
    TerminalSession: "ask",
    AskUserQuestion: "deny",
    ExitPlanMode: "allow",
  });
  assert.deepEqual(Object.keys(policies), [
    "AskUserQuestion",
    "ExitPlanMode",
    "Grep",
    "TerminalSession",
  ]);
  assert.equal(policies.Edit, undefined);
});

test("missing tool settings produce no policies", () => {
  assert.deepEqual(canonicalKBrainToolPolicies(undefined), {});
  assert.deepEqual(canonicalKBrainToolPolicies(null), {});
});

test("allowed K-brain tool names exclude frontend-only tools", () => {
  for (const name of ["Browser", "McpManager", "TunnelManager", "SSHManager", "ToolSearch"]) {
    assert.equal(KBRAIN_POLICY_TOOL_NAMES.has(name), false, name);
  }
});

test("trailing newline anchor uses a real CSS zero-width escape, not a literal backslash", () => {
  // `className` strings are not JS-unescaped, so `\\200b` reached Tailwind as two backslashes and
  // rendered a visible "\200b" after pasted messages ending in a newline.
  const source = readFileSync(
    new URL("../../../agent-ui/src/lib/chat/userMessageContent.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /className="before:content-\['\\200b'\]"/);
  assert.doesNotMatch(source, /content-\['\\\\200b'\]/);
});
