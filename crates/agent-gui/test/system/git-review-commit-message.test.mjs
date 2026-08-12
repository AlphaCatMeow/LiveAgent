import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const {
  buildGitCommitMessagePrompt,
  generateDetailedCommitMessage,
  parseGeneratedCommitMessage,
} = createTsModuleLoader().loadModule(
  "@liveagent/ui/components/project-tools/git-review/generateCommitMessage.ts",
);

function entry(path, indexStatus, overrides = {}) {
  return {
    path,
    oldPath: null,
    indexStatus,
    worktreeStatus: ".",
    kind: "modified",
    staged: true,
    conflicted: false,
    untracked: false,
    ...overrides,
  };
}

test("generates a semantic title and file-level staged details", () => {
  assert.equal(generateDetailedCommitMessage([]), "");
  assert.equal(
    generateDetailedCommitMessage([entry("src/newFeature.ts", "A")]),
    "feat: 新增源代码文件\n\n- src/newFeature.ts: 新增源代码文件",
  );
  assert.equal(
    generateDetailedCommitMessage([entry("src/Button.tsx", "M")], "en-US"),
    "feat: update component\n\n- src/Button.tsx: update component",
  );
  assert.equal(
    generateDetailedCommitMessage([entry("README.md", "D")]),
    "docs: 删除文档\n\n- README.md: 删除文档",
  );
  assert.equal(
    generateDetailedCommitMessage([
      entry("src/new.ts", "R", { kind: "renamed", oldPath: "src/old.ts" }),
    ]),
    "feat: 从 src/old.ts 重命名源代码文件\n\n- src/new.ts: 从 src/old.ts 重命名源代码文件",
  );
});

test("uses index status and lists every mixed staged file", () => {
  assert.equal(
    generateDetailedCommitMessage([
      entry("src/NewPanel.tsx", "A"),
      entry("src/model.ts", "M", { worktreeStatus: "D" }),
      entry("src/legacy.ts", "D"),
      entry("src/new-name.ts", "R", { kind: "renamed", oldPath: "src/old-name.ts" }),
    ]),
    [
      "feat: 更新应用代码",
      "",
      "- src/NewPanel.tsx: 新增组件",
      "- src/model.ts: 更新源代码文件",
      "- src/legacy.ts: 删除源代码文件",
      "- src/new-name.ts: 从 src/old-name.ts 重命名源代码文件",
    ].join("\n"),
  );
});

test("parses fenced model JSON and preserves staged file order", () => {
  const files = [entry("src/a.ts", "M"), entry("README.md", "M")];
  const response = `\`\`\`json
  {"title":"feat: improve review generation","bullets":[
    {"path":"README.md","summary":"document the generated commit body"},
    {"path":"src/a.ts","summary":"derive the title from the staged patch"}
  ]}
  \`\`\``;
  assert.equal(
    parseGeneratedCommitMessage(response, files),
    [
      "feat: improve review generation",
      "",
      "- src/a.ts: derive the title from the staged patch",
      "- README.md: document the generated commit body",
    ].join("\n"),
  );
});

test("rejects incomplete model output and sends only staged metadata", () => {
  const files = [entry("src/a.ts", "M"), entry("src/b.ts", "A")];
  assert.throws(
    () =>
      parseGeneratedCommitMessage(
        '{"title":"feat: update files","bullets":[{"path":"src/a.ts","summary":"update logic"}]}',
        files,
      ),
    /omitted staged files/,
  );

  const prompt = JSON.parse(
    buildGitCommitMessagePrompt({ patch: "diff --git a/src/a.ts b/src/a.ts", files, truncated: true }),
  );
  assert.equal(prompt.patch, "diff --git a/src/a.ts b/src/a.ts");
  assert.equal(prompt.truncated, true);
  assert.deepEqual(prompt.files[0], {
    path: "src/a.ts",
    oldPath: null,
    indexStatus: "M",
    kind: "modified",
  });
  assert.equal("worktreeStatus" in prompt.files[0], false);
});
