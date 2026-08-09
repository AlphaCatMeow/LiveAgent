import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const guiDrawer = readFileSync(
  new URL("../../src/components/chat/WorkspaceResourceSettingsDrawer.tsx", import.meta.url),
  "utf8",
);
const webDrawer = readFileSync(
  new URL(
    "../../../agent-gateway/web/src/components/chat/WorkspaceResourceSettingsDrawer.tsx",
    import.meta.url,
  ),
  "utf8",
);
const guiSidebar = readFileSync(
  new URL("../../src/components/chat/ChatHistorySidebar.tsx", import.meta.url),
  "utf8",
);
const webSidebar = readFileSync(
  new URL(
    "../../../agent-gateway/web/src/components/chat/ChatHistorySidebar.tsx",
    import.meta.url,
  ),
  "utf8",
);
const sendRuntime = readFileSync(
  new URL("../../src/pages/chat/runtime/useSendChatTurn.ts", import.meta.url),
  "utf8",
);
const guiChatPage = readFileSync(new URL("../../src/pages/ChatPage.tsx", import.meta.url), "utf8");
const guiWorkspaceRemoval = readFileSync(
  new URL("../../src/pages/chat/workspace/useWorkspaceProjectRemoval.tsx", import.meta.url),
  "utf8",
);
const webGatewayApp = readFileSync(
  new URL("../../../agent-gateway/web/src/app/GatewayApp.tsx", import.meta.url),
  "utf8",
);
const guiSkillsHub = readFileSync(
  new URL("../../src/pages/skills-hub/SkillsHubPage.tsx", import.meta.url),
  "utf8",
);
const guiMcpHub = readFileSync(
  new URL("../../src/pages/mcp-hub/McpServersForm.tsx", import.meta.url),
  "utf8",
);

test("workspace resources use one entry and one combined settings drawer", () => {
  for (const sidebar of [guiSidebar, webSidebar]) {
    assert.match(sidebar, /chat\.workspaceResources/);
    assert.match(sidebar, /onConfigureProjectResources\(project\)/);
  }
  assert.equal(guiDrawer, webDrawer);
  assert.match(guiDrawer, /\["inherit", "custom", "off"\]/);
  assert.match(guiDrawer, /\["skills", "mcp"\]/);
  assert.match(guiDrawer, /CLAWHUB_CATEGORY_SLUGS/);
  assert.match(guiDrawer, /ResourceActivationSwitch/);
  assert.doesNotMatch(guiDrawer, /McpImportView|McpRegistryBrowser|SkillsStoreView/);
});

test("chat runtime resolves and snapshots workspace resources from the effective workdir", () => {
  assert.match(sendRuntime, /resolveWorkspaceResources\(settings, effectiveWorkdir\)/);
  assert.match(sendRuntime, /workspaceResources\.skillNames/);
  assert.match(sendRuntime, /filterMcpSettingsForWorkspace\(getMcpSettings\(\), workspaceResources\)/);
  assert.match(sendRuntime, /getMcpSettings: getEffectiveMcpSettings/);
  assert.match(sendRuntime, /missing\.length > 0 && workspaceResources\.mode !== "custom"/);
  assert.match(guiChatPage, /resolveWorkspaceResources\(settings, displayedConversationWorkdir\)/);
  assert.match(guiChatPage, /skillsEnabled: settings\.skills\.enabled && isAgentMode/);
  assert.match(guiDrawer, /chat\.workspaceResourcesMissingSkill/);
});

test("workspace and resource deletion paths clear workspace-scoped references", () => {
  assert.match(guiWorkspaceRemoval, /resetWorkspaceResourceSettings\(nextSettings, pathKey\)/);
  assert.match(webGatewayApp, /resetWorkspaceResourceSettings\(nextSettings, pathKey\)/);
  assert.match(guiSkillsHub, /removeWorkspaceResourceReferences\(/);
  assert.match(guiSkillsHub, /skillNames: \[skillName\]/);
  assert.match(guiMcpHub, /removeWorkspaceResourceReferences\(/);
  assert.match(guiMcpHub, /mcpServerIds: \[serverConfig\.id\]/);
  assert.match(sendRuntime, /change\.action !== "delete"/);
  assert.match(sendRuntime, /skillNames: change\.names/);
  assert.match(sendRuntime, /op\.kind === "remove"/);
  assert.match(sendRuntime, /mcpServerIds: removedIds/);
});

test("workspace settings control the actual Skill prompt and MCP tool registry", async () => {
  const listedServerIds = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          if (command !== "mcp_list_tools") {
            throw new Error(`Unexpected invoke: ${command}`);
          }
          const servers = args.servers ?? [];
          listedServerIds.push(servers.map((server) => server.id));
          return servers.map((server) => ({
            serverId: server.id,
            serverLabel: server.id,
            name: "probe",
            description: `Probe ${server.id}`,
            inputSchema: { type: "object" },
          }));
        },
      },
      "@tauri-apps/api/path": {
        async homeDir() {
          return "/home/test";
        },
      },
    },
  });
  const settingsModule = loader.loadModule("src/lib/settings/index.ts");
  const skillsModule = loader.loadModule("src/lib/skills/index.ts");
  const { buildBuiltinToolRegistry } = loader.loadModule("src/lib/tools/builtinRegistry.ts");
  const { createFileToolState } = loader.loadModule("src/lib/tools/fileToolState.ts");

  const appSettings = settingsModule.normalizeSettings({
    skills: { enabled: true, selected: ["global-skill"] },
    mcp: {
      servers: [
        {
          id: "global-mcp",
          enabled: true,
          transport: "stdio",
          command: "global-mcp",
          args: [],
          env: {},
        },
        {
          id: "workspace-mcp",
          enabled: true,
          transport: "stdio",
          command: "workspace-mcp",
          args: [],
          env: {},
        },
      ],
    },
    system: {
      workspaceResourceSettings: {
        "/repo/custom": {
          mode: "custom",
          skillNames: ["workspace-skill"],
          mcpServerIds: ["workspace-mcp"],
          stateVersion: 1,
          writerId: "test",
          updatedAt: 1,
        },
        "/repo/off": {
          mode: "off",
          stateVersion: 1,
          writerId: "test",
          updatedAt: 1,
        },
      },
    },
  });
  const skillCatalog = [
    {
      name: "global-skill",
      description: "Global skill marker",
      skillFile: "global-skill/SKILL.md",
      baseDir: "global-skill",
    },
    {
      name: "workspace-skill",
      description: "Workspace skill marker",
      skillFile: "workspace-skill/SKILL.md",
      baseDir: "workspace-skill",
    },
  ];

  async function exposeResources(workdir) {
    const resources = settingsModule.resolveWorkspaceResources(appSettings, workdir);
    const selectedSkills = skillCatalog.filter((skill) =>
      resources.skillNames.includes(skill.name),
    );
    const skillPrompt = resources.skillsEnabled
      ? skillsModule.buildSkillsSystemPrompt({ rootDir: "/skills", selected: selectedSkills })
      : "";
    const registry = await buildBuiltinToolRegistry({
      workdir,
      providerId: "codex",
      fileState: createFileToolState(),
      skillsEnabled: resources.skillsEnabled,
      runtimeScope: "chat",
      getMcpSettings: () => ({ ...appSettings.mcp, servers: resources.mcpServers }),
    });
    return { resources, skillPrompt, toolNames: registry.tools.map((tool) => tool.name) };
  }

  const inherited = await exposeResources("/repo/inherit");
  assert.match(inherited.skillPrompt, /global-skill\/SKILL\.md/);
  assert.doesNotMatch(inherited.skillPrompt, /workspace-skill\/SKILL\.md/);
  assert.ok(inherited.toolNames.includes("mcp_global-mcp_probe"));
  assert.ok(inherited.toolNames.includes("mcp_workspace-mcp_probe"));

  const custom = await exposeResources("/repo/custom");
  assert.match(custom.skillPrompt, /workspace-skill\/SKILL\.md/);
  assert.doesNotMatch(custom.skillPrompt, /global-skill\/SKILL\.md/);
  assert.ok(custom.toolNames.includes("mcp_workspace-mcp_probe"));
  assert.ok(!custom.toolNames.includes("mcp_global-mcp_probe"));

  const off = await exposeResources("/repo/off");
  assert.equal(off.skillPrompt, "");
  assert.ok(!off.toolNames.some((name) => name.startsWith("mcp_")));
  assert.deepEqual(listedServerIds, [
    ["global-mcp", "workspace-mcp"],
    ["workspace-mcp"],
  ]);
});
