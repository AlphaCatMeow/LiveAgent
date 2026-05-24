import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const pathUtils = loader.loadModule("src/lib/tools/pathUtils.ts");
const systemTools = loader.loadModule("src/lib/tools/customSystemTools.ts");
const skillBuiltinHelpers = loader.loadModule("src/lib/skills/builtin.ts");

test("required tool paths must be relative workspace paths", () => {
  assert.equal(pathUtils.normalizeRequiredToolRelPath(" ./src\\App.tsx ", "path"), "src/App.tsx");

  for (const value of ["", ".", "..", "../secret", "/tmp/file", "C:/tmp/file", "safe:name"]) {
    assert.throws(
      () => pathUtils.normalizeRequiredToolRelPath(value, "path"),
      /path must be a relative path/,
      `expected ${value} to be rejected`,
    );
  }
});

test("optional tool paths allow empty root but reject escapes", () => {
  assert.equal(pathUtils.normalizeOptionalToolRelPath("", "path"), undefined);
  assert.equal(pathUtils.normalizeOptionalToolRelPath(".", "path"), undefined);
  assert.equal(pathUtils.normalizeOptionalToolRelPath("docs/readme.md", "path"), "docs/readme.md");

  for (const value of ["../secret", "/tmp/file", "C:/tmp/file", "foo:bar"]) {
    assert.throws(
      () => pathUtils.normalizeOptionalToolRelPath(value, "path"),
      /path must be a relative path/,
    );
  }
});

test("file tool roots default to workspace and gate skills root", () => {
  assert.equal(pathUtils.normalizeToolFileRoot(undefined, "Read.root"), "workspace");
  assert.equal(pathUtils.normalizeToolFileRoot("workspace", "Read.root"), "workspace");
  assert.equal(
    pathUtils.normalizeToolFileRoot("skills", "Read.root", { allowSkillsRoot: true }),
    "skills",
  );
  assert.throws(
    () => pathUtils.normalizeToolFileRoot("skills", "Read.root"),
    /root=skills is only available when Skills are enabled/,
  );
  assert.throws(
    () => pathUtils.normalizeToolFileRoot("home", "Read.root", { allowSkillsRoot: true }),
    /root must be workspace or skills/,
  );
});

test("builtin agent skills stay selected and sort first", () => {
  assert.deepEqual(skillBuiltinHelpers.mergeAlwaysEnabledSkillNames(["demo-skill"]), [
    "skills-creator",
    "skills-installer",
    "demo-skill",
  ]);
  assert.deepEqual(
    skillBuiltinHelpers.sortSkillsForDisplay([
      { name: "z-skill" },
      { name: "skills-installer" },
      { name: "a-skill" },
      { name: "skills-creator" },
    ]).map((skill) => skill.name),
    ["skills-creator", "skills-installer", "a-skill", "z-skill"],
  );
  assert.equal(skillBuiltinHelpers.isUserSelectableSkillName("skills-creator"), false);
  assert.equal(skillBuiltinHelpers.isUserSelectableSkillName("workflow-skill"), true);
});

test("file tools can read from the fixed skills root without exposing absolute paths as arguments", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          assert.equal(command, "fs_read_text");
          return {
            kind: "text",
            path: args.path,
            content: "1\t---\n2\tname: demo\n",
            truncated: false,
            startLine: 1,
            numLines: 2,
            totalLines: 2,
            isPartialView: false,
            mtimeMs: 10,
            contentHash: "hash",
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    fileState: fileToolState.createFileToolState(),
  });

  const readTool = bundle.tools.find((tool) => tool.name === "Read");
  assert.match(JSON.stringify(readTool.parameters), /"skills"/);

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "read-skill-file",
    name: "Read",
    arguments: {
      root: "skills",
      path: "skills-creator/SKILL.md",
      limit: 20,
    },
  });

  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "read_text");
  assert.equal(result.details.root, "skills");
  assert.equal(result.details.path, "skills-creator/SKILL.md");
  assert.match(result.content[0].text, /Read: root=skills path=skills-creator\/SKILL\.md/);
  assert.deepEqual(invocations, [
    {
      command: "fs_read_text",
      args: {
        workdir: "/Users/me/.liveagent/skills",
        path: "skills-creator/SKILL.md",
        start_line: undefined,
        limit: 20,
        page_start: undefined,
        page_limit: undefined,
        cell_start: undefined,
        cell_limit: undefined,
      },
    },
  ]);
});

test("file tools enforce enabled Skill allowlist for root=skills", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("unexpected invoke");
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    skillAccessPolicy: {
      allowedSkillNames: ["skills-creator"],
      allowedSkillBaseDirs: ["skills-creator"],
    },
    fileState: fileToolState.createFileToolState(),
  });

  const readResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-skill-read",
    name: "Read",
    arguments: {
      root: "skills",
      path: "metaphysics-steward/SKILL.md",
    },
  });
  assert.equal(readResult.isError, true);
  assert.match(readResult.content[0].text, /metaphysics-steward\/SKILL\.md.*is not enabled/);
  assert.match(readResult.content[0].text, /Allowed Skills in this conversation: skills-creator/);

  const globResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-skill-glob",
    name: "Glob",
    arguments: {
      root: "skills",
      pattern: "metaphysics-steward/scripts/**/*",
    },
  });
  assert.equal(globResult.isError, true);
  assert.match(globResult.content[0].text, /metaphysics-steward\/scripts\/\*\*\/\*/);
  assert.deepEqual(invocations, []);
});

test("file tools allow direct mutations inside enabled Skills when mutation is granted", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          assert.equal(command, "fs_write_text");
          return {
            existedBefore: false,
            bytesWritten: 34,
            mtimeMs: 123,
            contentHash: "hash",
            totalLines: 4,
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    skillAccessPolicy: {
      allowedSkillNames: ["demo"],
      allowedSkillBaseDirs: ["demo"],
      allowSkillMutation: true,
    },
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-skill-write",
    name: "Write",
    arguments: {
      root: "skills",
      path: "demo/SKILL.md",
      content: "---\nname: demo\ndescription: Demo\n---\n",
    },
  });

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /Write: root=skills path=demo\/SKILL\.md/);
  assert.match(result.content[0].text, /mode=rewrite/);
  assert.deepEqual(invocations, [
    {
      command: "fs_write_text",
      args: {
        workdir: "/Users/me/.liveagent/skills",
        path: "demo/SKILL.md",
        content: "---\nname: demo\ndescription: Demo\n---\n",
        mode: "rewrite",
        expected_mtime_ms: undefined,
        expected_content_hash: undefined,
      },
    },
  ]);
});

test("file tools block direct mutations inside built-in Skills", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("unexpected invoke");
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    skillAccessPolicy: {
      allowedSkillNames: ["skills-creator", "skills-installer"],
      allowedSkillBaseDirs: ["skills-creator", "skills-installer"],
      allowSkillMutation: true,
    },
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-builtin-skill-write",
    name: "Write",
    arguments: {
      root: "skills",
      path: "skills-creator/SKILL.md",
      content: "---\nname: skills-creator\ndescription: Changed\n---\n",
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /built-in Skill "skills-creator" is protected/);
  assert.match(result.content[0].text, /cannot be modified by the model/);
  assert.deepEqual(invocations, []);
});

test("file tools reject absolute skills paths with a root=skills retry hint", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("unexpected invoke");
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "bad-read",
    name: "Read",
    arguments: {
      path: "/Users/me/.liveagent/skills/skills-installer/SKILL.md",
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Retry with root="skills"/);
  assert.match(result.content[0].text, /path="skills-installer\/SKILL\.md"/);
  assert.match(result.content[0].text, /Do not use Bash/);
  assert.deepEqual(invocations, []);
});

test("file tool runtime errors tell the model to stay on scoped file tools", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("I/O error: No such file or directory (os error 2)");
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "missing-skill-file",
    name: "Read",
    arguments: {
      root: "skills",
      path: "demo/missing.md",
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Read failed for root=skills path=demo\/missing\.md/);
  assert.match(result.content[0].text, /Retry with root="skills", path="demo\/missing\.md"/);
  assert.match(result.content[0].text, /Use List\/Glob\/Grep with the same root to locate files/);
  assert.match(result.content[0].text, /Do not use Bash/);
  assert.deepEqual(invocations, [
    {
      command: "fs_read_text",
      args: {
        workdir: "/Users/me/.liveagent/skills",
        path: "demo/missing.md",
        start_line: undefined,
        limit: undefined,
        page_start: undefined,
        page_limit: undefined,
        cell_start: undefined,
        cell_limit: undefined,
      },
    },
  ]);
});

test("Grep retries file paths as parent directory plus file_pattern", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          assert.equal(command, "fs_grep");
          if (invocations.length === 1) {
            assert.equal(args.path, "src/App.tsx");
            assert.equal(args.file_pattern, undefined);
            throw new Error("Grep.path must be a directory");
          }
          assert.equal(args.path, "src");
          assert.equal(args.file_pattern, "App.tsx");
          return {
            path: "src",
            pattern: "render",
            filePattern: "App.tsx",
            ignoreCase: true,
            outputMode: "content",
            headLimit: 20,
            offset: 0,
            context: 0,
            multiline: false,
            matchCount: 1,
            fileCount: 1,
            hasMore: false,
            matches: [
              {
                path: "src/App.tsx",
                line: 12,
                text: "render();",
                before: [],
                after: [],
              },
            ],
            files: [{ path: "src/App.tsx", count: 1, firstLine: 12 }],
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "grep-file-path",
    name: "Grep",
    arguments: {
      path: "src/App.tsx",
      pattern: "render",
      output_mode: "content",
      head_limit: 20,
    },
  });

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /autoCorrectedPath=src\/App\.tsx file_pattern=App\.tsx/);
  assert.equal(result.details.path, "src");
  assert.equal(result.details.filePattern, "App.tsx");
  assert.equal(invocations.length, 2);
});

test("Edit auto-primes a full text snapshot before replacement", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          if (command === "fs_read_text") {
            assert.equal(args.path, "src/App.tsx");
            assert.equal(args.limit, 5000);
            return {
              kind: "text",
              path: "src/App.tsx",
              content: "1\tconst value = 'old';\n",
              truncated: false,
              startLine: 1,
              numLines: 1,
              totalLines: 1,
              isPartialView: false,
              mtimeMs: 44,
              contentHash: "before-hash",
            };
          }
          assert.equal(command, "fs_edit_text");
          assert.equal(args.path, "src/App.tsx");
          assert.equal(args.expected_mtime_ms, 44);
          assert.equal(args.expected_content_hash, "before-hash");
          return {
            path: "src/App.tsx",
            replacements: 1,
            replaceAll: false,
            mtimeMs: 45,
            contentHash: "after-hash",
            totalLines: 1,
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "edit-without-read",
    name: "Edit",
    arguments: {
      path: "src/App.tsx",
      old_string: "old",
      new_string: "new",
    },
  });

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /autoRead=full/);
  assert.equal(result.details.replacements, 1);
  assert.deepEqual(invocations.map((call) => call.command), ["fs_read_text", "fs_edit_text"]);
});

test("SkillsManager legacy read form is routed through manage action payload", async () => {
  const invocations = [];
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          assert.equal(command, "system_manage_skill");
          return {
            action: "read",
            rootDir: "/Users/me/.liveagent/skills",
            path: args.payload.path,
            content: "line one\nline two\n",
            truncated: false,
            startLine: 3,
            numLines: 2,
          };
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const bundle = skillTools.createSkillTools();

  assert.equal(bundle.metadataByName.get("SkillsManager").kind, "manage_skill");
  assert.equal(bundle.metadataByName.get("SkillsManager").isReadOnly, false);

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "skill-read",
    name: "SkillsManager",
    arguments: {
      path: "skills-installer/SKILL.md",
      offset: 2,
      length: 2,
    },
  });

  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "read_skill");
  assert.equal(result.details.path, "skills-installer/SKILL.md");
  assert.equal(result.details.startLine, 3);
  assert.equal(result.details.numLines, 2);
  assert.match(result.content[0].text, /<LiveAgentSkillFileRules>/);
  assert.match(result.content[0].text, /root="skills"/);
  assert.match(result.content[0].text, /path="skills-installer\/\.\.\."/);
  assert.match(result.content[0].text, /Do not use Bash/);
  assert.deepEqual(invocations, [
    {
      command: "system_manage_skill",
      args: {
        payload: {
          action: "read",
          path: "skills-installer/SKILL.md",
          offset: 2,
          length: 2,
        },
      },
    },
  ]);
});

test("SkillsManager install resolves local relative sources against the workspace", async () => {
  const invocations = [];
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          assert.equal(command, "system_manage_skill");
          return {
            action: "install",
            rootDir: "/Users/me/.liveagent/skills",
            installed: [
              {
                name: "chart-image",
                target: "/Users/me/.liveagent/skills/chart-image",
                backup: null,
                skillFile: "chart-image/SKILL.md",
              },
            ],
          };
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const bundle = skillTools.createSkillTools({
    workdir: "/Users/me/project",
    skillAccessPolicy: {
      allowedSkillNames: ["skills-installer"],
      allowedSkillBaseDirs: ["skills-installer"],
      allowSkillManagement: true,
    },
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "install-relative-source",
    name: "SkillsManager",
    arguments: {
      action: "install",
      source: "./skills/chart-image",
    },
  });

  assert.equal(result.isError, false);
  assert.equal(
    invocations[0].args.payload.source,
    "/Users/me/project/skills/chart-image",
  );
});

test("SkillsManager blocks unread enabled-Skill policy violations before backend invoke", async () => {
  const invocations = [];
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("unexpected invoke");
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const bundle = skillTools.createSkillTools({
    skillAccessPolicy: {
      allowedSkillNames: ["skills-creator"],
      allowedSkillBaseDirs: ["skills-creator"],
      allowSkillInventory: false,
      allowSkillManagement: false,
    },
  });

  const readResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-skill-manager-read",
    name: "SkillsManager",
    arguments: {
      action: "read",
      path: "metaphysics-steward/SKILL.md",
    },
  });
  assert.equal(readResult.isError, true);
  assert.match(readResult.content[0].text, /metaphysics-steward\/SKILL\.md.*is not enabled/);

  const listResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-skill-manager-list",
    name: "SkillsManager",
    arguments: {
      action: "list",
    },
  });
  assert.equal(listResult.isError, true);
  assert.match(listResult.content[0].text, /SkillsManager\(action=list\) is blocked/);

  const installResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-skill-manager-install",
    name: "SkillsManager",
    arguments: {
      action: "install",
      source: "https://github.com/example/repo/tree/main/skills/new-skill",
    },
  });
  assert.equal(installResult.isError, true);
  assert.match(installResult.content[0].text, /SkillsManager\(action="install"\) is blocked/);
  const packageResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-skill-manager-package",
    name: "SkillsManager",
    arguments: {
      action: "package",
      name: "demo",
    },
  });
  assert.equal(packageResult.isError, true);
  assert.match(packageResult.content[0].text, /SkillsManager\(action="package"\) is blocked/);
  assert.deepEqual(invocations, []);
});

test("SkillsManager blocks built-in Skill create/install targets before backend invoke", async () => {
  const invocations = [];
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("unexpected invoke");
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const bundle = skillTools.createSkillTools({
    skillAccessPolicy: {
      allowedSkillNames: ["skills-creator", "skills-installer"],
      allowedSkillBaseDirs: ["skills-creator", "skills-installer"],
      allowSkillManagement: true,
    },
  });

  const createResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-builtin-create",
    name: "SkillsManager",
    arguments: {
      action: "create",
      name: "skills-creator",
      description: "Changed creator",
      body: "## Workflow\n\n1. Change builtin.",
      conflict: "overwrite",
    },
  });
  assert.equal(createResult.isError, true);
  assert.match(createResult.content[0].text, /built-in Skill "skills-creator" is protected/);

  const installResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-builtin-install",
    name: "SkillsManager",
    arguments: {
      action: "install",
      source: "./replacement",
      name: "skills-installer",
      conflict: "overwrite",
    },
  });
  assert.equal(installResult.isError, true);
  assert.match(installResult.content[0].text, /built-in Skill "skills-installer" is protected/);
  assert.deepEqual(invocations, []);
});

test("SkillsManager management can auto-enable installed Skills without exposing inventory", async () => {
  const invocations = [];
  const changes = [];
  const events = [];
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          assert.equal(command, "system_manage_skill");
          const action = args.payload.action;
          if (action === "install") {
            return {
              action: "install",
              rootDir: "/Users/me/.liveagent/skills",
              installed: [
                {
                  name: "new-skill",
                  target: "/Users/me/.liveagent/skills/new-skill",
                  backup: null,
                  skillFile: "new-skill/SKILL.md",
                },
              ],
            };
          }
          if (action === "read") {
            assert.equal(args.payload.path, "new-skill/SKILL.md");
            return {
              action: "read",
              rootDir: "/Users/me/.liveagent/skills",
              path: "new-skill/SKILL.md",
              content: "---\nname: new-skill\ndescription: New Skill\n---\n",
              truncated: false,
              startLine: 1,
              numLines: 4,
            };
          }
          if (action === "list") {
            return {
              action: "list",
              rootDir: "/Users/me/.liveagent/skills",
              skills: [
                {
                  name: "skills-creator",
                  description: "Create Skills",
                  target: "/Users/me/.liveagent/skills/skills-creator",
                  skillFile: "skills-creator/SKILL.md",
                  baseDir: "skills-creator",
                },
                {
                  name: "skills-installer",
                  description: "Install Skills",
                  target: "/Users/me/.liveagent/skills/skills-installer",
                  skillFile: "skills-installer/SKILL.md",
                  baseDir: "skills-installer",
                },
                {
                  name: "new-skill",
                  description: "New Skill",
                  target: "/Users/me/.liveagent/skills/new-skill",
                  skillFile: "new-skill/SKILL.md",
                  baseDir: "new-skill",
                },
                {
                  name: "hidden-skill",
                  description: "Hidden Skill",
                  target: "/Users/me/.liveagent/skills/hidden-skill",
                  skillFile: "hidden-skill/SKILL.md",
                  baseDir: "hidden-skill",
                },
              ],
              invalid: [],
            };
          }
          throw new Error(`unexpected action ${action}`);
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const policy = {
    allowedSkillNames: ["skills-creator", "skills-installer"],
    allowedSkillBaseDirs: ["skills-creator", "skills-installer"],
    allowSkillInventory: true,
    allowSkillManagement: true,
  };
  const bundle = skillTools.createSkillTools({
    skillAccessPolicy: policy,
    onManagedSkillsChanged(change) {
      changes.push(change);
    },
  });
  const previousWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event.type);
    },
  };

  try {
    const installResult = await bundle.executeToolCall({
      type: "toolCall",
      id: "skill-install",
      name: "SkillsManager",
      arguments: {
        action: "install",
        source: "https://github.com/example/repo/tree/main/skills/new-skill",
        conflict: "backup",
      },
    });

    assert.equal(installResult.isError, false);
    assert.match(installResult.content[0].text, /installed=1/);
    assert.match(installResult.content[0].text, /skillFile=new-skill\/SKILL\.md/);
    assert.match(installResult.content[0].text, /enabled=true/);
    assert.deepEqual(policy.allowedSkillNames, [
      "skills-creator",
      "skills-installer",
      "new-skill",
    ]);
    assert.deepEqual(policy.allowedSkillBaseDirs, [
      "skills-creator",
      "skills-installer",
      "new-skill",
    ]);
    assert.deepEqual(changes, [
      {
        action: "install",
        names: ["new-skill"],
        baseDirs: ["new-skill"],
      },
    ]);

    const listResult = await bundle.executeToolCall({
      type: "toolCall",
      id: "visible-list-after-install",
      name: "SkillsManager",
      arguments: { action: "list" },
    });
    assert.equal(listResult.isError, false);
    assert.match(listResult.content[0].text, /visible=enabled-skills-only/);
    assert.match(listResult.content[0].text, /skills=3/);
    assert.match(listResult.content[0].text, /skills-creator/);
    assert.match(listResult.content[0].text, /skills-installer/);
    assert.match(listResult.content[0].text, /new-skill/);
    assert.doesNotMatch(listResult.content[0].text, /hidden-skill/);
    assert.equal(listResult.details.skillsCount, 3);

    const readResult = await bundle.executeToolCall({
      type: "toolCall",
      id: "read-new-skill",
      name: "SkillsManager",
      arguments: {
        action: "read",
        path: "new-skill/SKILL.md",
      },
    });
    assert.equal(readResult.isError, false);
    assert.equal(readResult.details.path, "new-skill/SKILL.md");
    assert.deepEqual(events, ["liveagent:skills-discovery-updated"]);
  } finally {
    if (typeof previousWindow === "undefined") {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("SkillsManager list filters installed Skills when inventory is explicitly allowed", async () => {
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command) {
          assert.equal(command, "system_manage_skill");
          return {
            action: "list",
            rootDir: "/Users/me/.liveagent/skills",
            skills: [
              {
                name: "skills-creator",
                description: "Create Skills",
                skillFile: "skills-creator/SKILL.md",
                baseDir: "skills-creator",
              },
              {
                name: "metaphysics-steward",
                description: "Metaphysics",
                skillFile: "metaphysics-steward/SKILL.md",
                baseDir: "metaphysics-steward",
              },
            ],
            invalid: [],
          };
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const bundle = skillTools.createSkillTools({
    skillAccessPolicy: {
      allowedSkillNames: ["skills-creator"],
      allowedSkillBaseDirs: ["skills-creator"],
      allowSkillInventory: true,
      allowSkillManagement: false,
    },
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "filtered-skill-list",
    name: "SkillsManager",
    arguments: { action: "list" },
  });

  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /skills=1/);
  assert.match(result.content[0].text, /skills-creator/);
  assert.doesNotMatch(result.content[0].text, /metaphysics-steward/);
  assert.equal(result.details.skillsCount, 1);
});

test("SkillsManager read errors route sibling Skill files back to file tools", async () => {
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command) {
          assert.equal(command, "system_manage_skill");
          throw new Error("Failed to resolve the Skill file: No such file or directory (os error 2)");
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const bundle = skillTools.createSkillTools();

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "skill-read-missing-sibling",
    name: "SkillsManager",
    arguments: {
      action: "read",
      path: "global-memory/settings.json",
    },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SkillsManager\(action="read"\) is for Skill entry files/);
  assert.match(result.content[0].text, /looks like a sibling file inside a Skill/);
  assert.match(result.content[0].text, /Read\/List\/Glob\/Grep using root="skills" and path="global-memory\/\.\.\."/);
  assert.match(result.content[0].text, /Do not use Bash cat\/ls\/find\/grep/);
});

test("SkillsManager create action builds payload and refreshes skill discovery", async () => {
  const invocations = [];
  const events = [];
  const changes = [];
  const skillLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          assert.equal(command, "system_manage_skill");
          const action = args.payload.action;
          if (action === "create") {
            return {
              action,
              rootDir: "/Users/me/.liveagent/skills",
              created: {
                name: "workflow-skill",
                target: "/Users/me/.liveagent/skills/workflow-skill",
                backup: null,
                skillFile: "workflow-skill/SKILL.md",
              },
            };
          }
          if (action === "validate") {
            return {
              action,
              rootDir: "/Users/me/.liveagent/skills",
              validation: {
                name: "workflow-skill",
                target: "/Users/me/.liveagent/skills/workflow-skill",
                ok: true,
                errors: [],
              },
            };
          }
          if (action === "package") {
            return {
              action,
              rootDir: "/Users/me/.liveagent/skills",
              package: {
                name: "workflow-skill",
                target: "/Users/me/.liveagent/skills/workflow-skill",
                archive: "/Users/me/.liveagent/skills/.packages/workflow-skill.skill",
              },
            };
          }
          throw new Error(`unexpected action ${action}`);
        },
      },
    },
  });
  const skillTools = skillLoader.loadModule("src/lib/tools/skillTools.ts");
  const policy = {
    allowedSkillNames: ["skills-creator", "skills-installer"],
    allowedSkillBaseDirs: ["skills-creator", "skills-installer"],
    allowSkillInventory: false,
    allowSkillManagement: true,
  };
  const bundle = skillTools.createSkillTools({
    skillAccessPolicy: policy,
    onManagedSkillsChanged(change) {
      changes.push(change);
    },
  });
  const previousWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent(event) {
      events.push(event.type);
    },
  };

  try {
    const result = await bundle.executeToolCall({
      type: "toolCall",
      id: "skill-create",
      name: "SkillsManager",
      arguments: {
        action: "create",
        name: "workflow-skill",
        description: "Capture a repeated workflow",
        body: "## Workflow\n\n1. Do the thing.",
        files: [{ path: "references/notes.md", content: "Notes" }],
        conflict: "fail",
      },
    });

    assert.equal(result.isError, false);
    assert.equal(result.details.kind, "manage_skill");
    assert.equal(result.details.action, "create");
    assert.equal(result.details.createdName, "workflow-skill");
    assert.equal(result.details.target, "/Users/me/.liveagent/skills/workflow-skill");
    assert.match(result.content[0].text, /root=skills/);
    assert.match(result.content[0].text, /target=skills:workflow-skill/);
    assert.match(result.content[0].text, /skillFile=workflow-skill\/SKILL\.md/);
    assert.match(result.content[0].text, /enabled=true/);
    assert.doesNotMatch(result.content[0].text, /\/Users\/me\/\.liveagent\/skills/);
    assert.deepEqual(policy.allowedSkillNames, [
      "skills-creator",
      "skills-installer",
      "workflow-skill",
    ]);
    assert.deepEqual(policy.allowedSkillBaseDirs, [
      "skills-creator",
      "skills-installer",
      "workflow-skill",
    ]);
    assert.deepEqual(changes, [
      {
        action: "create",
        names: ["workflow-skill"],
        baseDirs: ["workflow-skill"],
      },
    ]);

    const validateResult = await bundle.executeToolCall({
      type: "toolCall",
      id: "skill-validate",
      name: "SkillsManager",
      arguments: {
        action: "validate",
        name: "workflow-skill",
      },
    });
    assert.equal(validateResult.isError, false);
    assert.equal(validateResult.details.validationOk, true);

    const packageResult = await bundle.executeToolCall({
      type: "toolCall",
      id: "skill-package",
      name: "SkillsManager",
      arguments: {
        action: "package",
        name: "workflow-skill",
      },
    });
    assert.equal(packageResult.isError, false);
    assert.match(packageResult.content[0].text, /archive=skills:\.packages\/workflow-skill\.skill/);
    assert.deepEqual(events, ["liveagent:skills-discovery-updated"]);
    assert.deepEqual(invocations, [
      {
        command: "system_manage_skill",
        args: {
          payload: {
            action: "create",
            name: "workflow-skill",
            description: "Capture a repeated workflow",
            body: "## Workflow\n\n1. Do the thing.",
            files: [{ path: "references/notes.md", content: "Notes" }],
            conflict: "fail",
          },
        },
      },
      {
        command: "system_manage_skill",
        args: {
          payload: {
            action: "validate",
            name: "workflow-skill",
          },
        },
      },
      {
        command: "system_manage_skill",
        args: {
          payload: {
            action: "package",
            name: "workflow-skill",
          },
        },
      },
    ]);
  } finally {
    if (typeof previousWindow === "undefined") {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test("Image file tool returns display image details and inline image content", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          return {
            kind: "image",
            path: "uploads/001.jpg",
            mimeType: "image/jpeg",
            data: "abc123",
            sizeBytes: 12,
            mtimeMs: 10,
            contentHash: "hash",
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    fileState: fileToolState.createFileToolState(),
  });

  assert.deepEqual(bundle.tools.map((tool) => tool.name).slice(0, 2), ["Read", "Image"]);
  assert.equal(bundle.metadataByName.get("Image").kind, "display_image");
  assert.equal(bundle.metadataByName.get("Image").isReadOnly, true);

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "image-call",
    name: "Image",
    arguments: { path: "uploads/001.jpg" },
  });

  assert.equal(result.isError, false);
  assert.equal(result.toolName, "Image");
  assert.equal(result.details.kind, "display_image");
  assert.equal(result.details.path, "uploads/001.jpg");
  assert.equal(result.details.mimeType, "image/jpeg");
  assert.deepEqual(result.details.images, [
    {
      path: "uploads/001.jpg",
      sourceType: "path",
      renderMode: "inline",
      mimeType: "image/jpeg",
      sizeBytes: 12,
      mtimeMs: 10,
      contentHash: "hash",
    },
  ]);
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/jpeg");
  assert.equal(result.content[1].data, "abc123");
  assert.deepEqual(invocations, [
    {
      command: "fs_read_image_source",
      args: {
        workdir: "/workspace",
        source: "uploads/001.jpg",
        source_type: "path",
        mime_type: undefined,
      },
    },
  ]);
});

test("Image file tool reads installed Skill images through root=skills", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          return {
            kind: "image",
            path: args.source,
            mimeType: "image/png",
            data: "skill-image",
            sizeBytes: 64,
            mtimeMs: 12,
            contentHash: "skill-hash",
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    fileState: fileToolState.createFileToolState(),
  });

  const imageTool = bundle.tools.find((tool) => tool.name === "Image");
  assert.match(JSON.stringify(imageTool.parameters), /"skills"/);

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "image-skill-call",
    name: "Image",
    arguments: { root: "skills", path: "demo/assets/logo.png" },
  });

  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "display_image");
  assert.equal(result.details.images[0].root, "skills");
  assert.equal(result.details.images[0].path, "demo/assets/logo.png");
  assert.match(result.content[0].text, /Display image: root=skills path=demo\/assets\/logo\.png/);
  assert.deepEqual(invocations, [
    {
      command: "fs_read_image_source",
      args: {
        workdir: "/Users/me/.liveagent/skills",
        source: "demo/assets/logo.png",
        source_type: "path",
        mime_type: undefined,
      },
    },
  ]);
});

test("Image file tool rejects absolute workspace and Skill paths with scoped retry hints", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("unexpected invoke");
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    fileState: fileToolState.createFileToolState(),
  });

  const workspaceResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "bad-workspace-image",
    name: "Image",
    arguments: { path: "/workspace/uploads/logo.png" },
  });
  assert.equal(workspaceResult.isError, true);
  assert.match(
    workspaceResult.content[0].text,
    /Retry with root="workspace" \(or omit root\), path="uploads\/logo\.png"/,
  );
  assert.match(workspaceResult.content[0].text, /Do not use Bash/);

  const skillsResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "bad-skill-image",
    name: "Image",
    arguments: { path: "/Users/me/.liveagent/skills/demo/assets/logo.png" },
  });
  assert.equal(skillsResult.isError, true);
  assert.match(skillsResult.content[0].text, /Retry with root="skills", path="demo\/assets\/logo\.png"/);
  assert.match(skillsResult.content[0].text, /Do not use Bash/);

  const homeSkillsResult = await bundle.executeToolCall({
    type: "toolCall",
    id: "bad-home-skill-image",
    name: "Image",
    arguments: { path: "~/.liveagent/skills/demo/assets/logo.png" },
  });
  assert.equal(homeSkillsResult.isError, true);
  assert.match(
    homeSkillsResult.content[0].text,
    /Retry with root="skills", path="demo\/assets\/logo\.png"/,
  );
  assert.match(homeSkillsResult.content[0].text, /Do not use Bash/);
  assert.deepEqual(invocations, []);
});

test("Image file tool blocks fixed Skills root paths when Skills are disabled", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("unexpected invoke");
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/Users/me/project",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "blocked-disabled-skill-image",
    name: "Image",
    arguments: { path: "~/.liveagent/skills/demo/assets/logo.png" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /fixed Skills root.*blocked/);
  assert.match(result.content[0].text, /Enable the Skill.*root="skills", path="demo\/assets\/logo\.png"/);
  assert.deepEqual(invocations, []);
});

test("Image runtime errors tell the model to retry with scoped image paths", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          throw new Error("I/O error: No such file or directory (os error 2)");
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    skillsRootEnabled: true,
    skillsRootDir: "/Users/me/.liveagent/skills",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "missing-skill-image",
    name: "Image",
    arguments: { root: "skills", path: "demo/assets/missing.png" },
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Image failed for root=skills path=demo\/assets\/missing\.png/);
  assert.match(result.content[0].text, /Retry with root="skills", path="demo\/assets\/missing\.png"/);
  assert.match(result.content[0].text, /Use List\/Glob\/Grep with the same root to locate files/);
  assert.match(result.content[0].text, /Do not use Bash/);
  assert.deepEqual(invocations, [
    {
      command: "fs_read_image_source",
      args: {
        workdir: "/Users/me/.liveagent/skills",
        source: "demo/assets/missing.png",
        source_type: "path",
        mime_type: undefined,
      },
    },
  ]);
});

test("Image file tool returns multiple inline images from one call", async () => {
  const invocations = [];
  const imageByPath = new Map([
    [
      "uploads/001.jpg",
      {
        kind: "image",
        path: "uploads/001.jpg",
        mimeType: "image/jpeg",
        data: "abc123",
        sizeBytes: 12,
        mtimeMs: 10,
        contentHash: "hash-1",
      },
    ],
    [
      "uploads/002.png",
      {
        kind: "image",
        path: "uploads/002.png",
        mimeType: "image/png",
        data: "def456",
        sizeBytes: 34,
        mtimeMs: 11,
        contentHash: "hash-2",
      },
    ],
  ]);
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          return imageByPath.get(args.source);
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "image-call",
    name: "Image",
    arguments: { paths: ["uploads/001.jpg", "uploads/002.png"] },
  });

  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "display_image");
  assert.equal(result.details.path, "uploads/001.jpg");
  assert.deepEqual(
    result.details.images.map((image) => image.path),
    ["uploads/001.jpg", "uploads/002.png"],
  );
  assert.equal(result.content.length, 3);
  assert.match(result.content[0].text, /Display images: 2/);
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/jpeg");
  assert.equal(result.content[1].data, "abc123");
  assert.equal(result.content[2].type, "image");
  assert.equal(result.content[2].mimeType, "image/png");
  assert.equal(result.content[2].data, "def456");
  assert.deepEqual(invocations.map((call) => call.args.source), [
    "uploads/001.jpg",
    "uploads/002.png",
  ]);
  assert.deepEqual(invocations.map((call) => call.args.source_type), ["path", "path"]);
});

test("Image file tool forwards SVG sources as inline images", async () => {
  const invocations = [];
  const svgSource = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          return {
            kind: "image",
            path: "inline-svg:image/svg+xml:40 bytes",
            mimeType: "image/svg+xml",
            data: "PHN2Zy8+",
            sizeBytes: 40,
            mtimeMs: 0,
            contentHash: "svg-hash",
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    fileState: fileToolState.createFileToolState(),
  });

  const imageTool = bundle.tools.find((tool) => tool.name === "Image");
  assert.match(imageTool.description, /SVG images/);

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "image-call",
    name: "Image",
    arguments: { source: svgSource },
  });

  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "display_image");
  assert.equal(result.details.mimeType, "image/svg+xml");
  assert.equal(result.details.images[0].mimeType, "image/svg+xml");
  assert.equal(result.content[1].type, "image");
  assert.equal(result.content[1].mimeType, "image/svg+xml");
  assert.equal(result.content[1].data, "PHN2Zy8+");
  assert.match(result.content[0].text, /mime=image\/svg\+xml/);
  assert.deepEqual(
    invocations.map((call) => [call.command, call.args.source_type, call.args.source]),
    [["fs_read_image_source", "auto", svgSource]],
  );
});

test("Image file tool accepts absolute paths, URLs, and base64 input", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          return {
            kind: "image",
            path:
              args.source_type === "base64"
                ? "base64:image/png:12 bytes"
                : args.source,
            mimeType: args.source_type === "url" ? "image/webp" : "image/png",
            data: `${args.source_type}-data`,
            sizeBytes: 12,
            mtimeMs: args.source_type === "path" ? 15 : 0,
            contentHash: `${args.source_type}-hash`,
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "image-call",
    name: "Image",
    arguments: {
      path: "/Users/me/Pictures/local.png",
      url: "https://example.com/remote.webp",
      base64: "data:image/png;base64,abc123",
    },
  });

  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "display_image");
  assert.deepEqual(
    invocations.map((call) => [call.command, call.args.source_type, call.args.source]),
    [
      ["fs_read_image_source", "path", "/Users/me/Pictures/local.png"],
      ["fs_read_image_source", "base64", "data:image/png;base64,abc123"],
    ],
  );
  assert.deepEqual(
    result.details.images.map((image) => image.path),
    [
      "/Users/me/Pictures/local.png",
      "https://example.com/remote.webp",
      "base64:image/png:12 bytes",
    ],
  );
  assert.deepEqual(
    result.content.slice(1).map((block) => [block.type, block.mimeType, block.data]),
    [
      ["image", "image/png", "path-data"],
      ["image", "image/png", "base64-data"],
    ],
  );
  assert.equal(result.details.images[1].sourceType, "url");
  assert.equal(result.details.images[1].renderMode, "proxy");
  assert.equal(result.details.images[1].sourceUrl, "https://example.com/remote.webp");
  assert.equal(result.details.loadMode, "mixed");
});

test("Image generic source infers raw base64 image input", async () => {
  const invocations = [];
  const fsLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          invocations.push({ command, args });
          return {
            kind: "image",
            path: "base64:image/png:12 bytes",
            mimeType: "image/png",
            data: "base64-data",
            sizeBytes: 12,
            mtimeMs: 0,
            contentHash: "base64-hash",
          };
        },
      },
    },
  });
  const fsTools = fsLoader.loadModule("src/lib/tools/fsTools.ts");
  const fileToolState = fsLoader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = fsTools.createFsTools({
    workdir: "/workspace",
    fileState: fileToolState.createFileToolState(),
  });

  const result = await bundle.executeToolCall({
    type: "toolCall",
    id: "image-call",
    name: "Image",
    arguments: {
      source: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      mimeType: "image/png",
    },
  });

  assert.equal(result.isError, false);
  assert.deepEqual(
    invocations.map((call) => [call.command, call.args.source_type, call.args.mime_type]),
    [["fs_read_image_source", "base64", "image/png"]],
  );
});

test("custom system tools expose only selected tools for the requested runtime scope", async () => {
  const bundle = systemTools.createCustomSystemTools({
    selectedToolIds: ["http_get_test"],
    runtimeScope: "chat",
    currentChatModel: { customProviderId: "p", model: "m" },
  });

  assert.equal(bundle.groupId, "system");
  assert.deepEqual(bundle.tools.map((tool) => tool.name), ["HttpGetTest"]);
  assert.equal(bundle.metadataByName.get("HttpGetTest").isReadOnly, true);
  assert.equal(bundle.metadataByName.get("HttpGetTest").displayCategory, "system");

  const aborted = new AbortController();
  aborted.abort();
  const abortedResult = await bundle.executeToolCall(
    { id: "call-1", name: "HttpGetTest", arguments: {} },
    aborted.signal,
  );
  assert.equal(abortedResult.isError, true);
  assert.equal(abortedResult.content[0].text, "Cancelled");

  const unknownResult = await bundle.executeToolCall({
    id: "call-2",
    name: "MissingTool",
    arguments: {},
  });
  assert.equal(unknownResult.isError, true);
  assert.match(unknownResult.content[0].text, /Unknown tool/);
});

test("custom system tool options remain in sync with selectable definitions", () => {
  assert.deepEqual(systemTools.CUSTOM_SYSTEM_TOOL_OPTIONS, [
    {
      id: "http_get_test",
      label: "本地 HTTP Test",
      description: "Call the network test endpoint and return the response body.",
    },
  ]);
});
