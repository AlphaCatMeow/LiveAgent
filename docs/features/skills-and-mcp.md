# Skills 与 MCP

## Skills 架构

| 层 | 路径 | 职责 |
|---|---|---|
| builtin source | `crates/agent-gui/src-tauri/prompt/skills/<skill-name>` | 内置 skills 源文件。 |
| runtime root | `~/.liveagent/skills` | 用户运行时 skills 根目录。 |
| Rust service | `src-tauri/src/services/skills.rs` | seed builtin、list/read/manage/install/create/validate/package/ClawHub。 |
| Frontend lib | `src/lib/skills/*`、WebUI copy | discover skills、build prompt、ClawHub client、install status。 |
| Tool | `src/lib/tools/skillTools.ts` | `SkillsManager`。 |
| Hub UI | `src/pages/skills-hub/SkillsHubPage.tsx`、WebUI mirror | Installed/Store 两个视图，选择、扫描、预览、安装。 |

## Builtin Skills

| Skill | 说明 |
|---|---|
| `skills-creator` | 指导模型创建新 Skill。 |
| `skills-installer` | 指导模型安装本地/GitHub/压缩包/ClawHub Skill。 |

这两个 builtin skill 在前端 `lib/skills/builtin.ts` 中作为 always enabled 名称处理，Rust 启动或扫描时可通过 `system_ensure_builtin_skills` seed 到 runtime root。

## SkillsManager

| Action | 说明 |
|---|---|
| `read` | 读取 Skill entry file，例如 `SKILL.md`、`skill.json`、`README.md`。 |
| `list` | 列出当前对话可见的已启用 Skills。 |
| `install` | 从本地目录、`.zip/.skill`、HTTP(S)、GitHub repo/tree/blob 导入。 |
| `create` | 根据 workflow 摘要创建新 Skill。 |
| `validate` | 校验已安装 Skill。 |
| `package` | 打包为 `.skill` archive。 |
| `clawhub_search` | 搜索/浏览 ClawHub。 |
| `clawhub_install` | 按 ClawHub slug 下载并安装。 |

## Skills 选择与 Prompt 注入

| 阶段 | 说明 |
|---|---|
| 扫描 | `discoverSkills()` 调用 Tauri 或 Gateway skill APIs，读取 runtime root 中的 Skill metadata。 |
| 选择 | Settings/Skills Hub 管理 `settings.skills.selected`，builtin always-on 自动合并。 |
| 注入 | Chat tools 模式下，`useChatSkills` 和 `lib/skills/index.ts` 生成当前对话可见 skills prompt。 |
| 访问 | 模型对 Skill 内文件的维护应通过 FS tools 的 skills root 能力和 `SkillsManager` 配合完成。 |

## MCP 架构

| 层 | 路径 | 职责 |
|---|---|---|
| MCP settings | `settings.mcp.servers`、`settings.mcp.selected` | server 配置与启用选择。 |
| MCP Hub UI | `src/pages/mcp-hub/*`、WebUI mirror | server form、registry browser、preview drawer、install draft。 |
| Registry client | `src/lib/mcpRegistry/index.ts`、WebUI copy | official registry、Smithery、Glama 等 registry 归一化。 |
| Rust runtime | `src-tauri/src/commands/mcp.rs` | stdio/http/sse server lifecycle、tools/list、call_tool、test/restart/stop/status。 |
| Dynamic tools | `src/lib/tools/mcpTools.ts` | 把 enabled MCP server 的工具暴露给模型。 |
| Manager tool | `src/lib/tools/mcpManagerTools.ts` | MCP 配置 CRUD、诊断与生命周期控制。 |

## MCP 动态工具生命周期

| 阶段 | 说明 |
|---|---|
| 配置 | 用户在 MCP Hub/Settings 添加 server，支持 stdio/http/sse 等 transport。 |
| 选择 | 只有 enabled 且 selected 的 server 会进入 runtime 工具加载。 |
| List tools | 前端调用 Tauri `mcp_list_tools`，Rust 端启动/同步 server 并返回 tool info。 |
| 命名 | 前端把 server/tool 名规范化为 `mcp_<server>_<tool>`，避免冲突和过长。 |
| Call tool | 模型调用动态工具，前端 executor 调用 Tauri `mcp_call_tool`，结果进入 tool trace。 |
| 管理 | `McpManager` 做 add/update/delete/enable/disable/status/test/restart/stop/tools/list。 |

## MCP Registry

| Source | 作用 |
|---|---|
| official registry | 从 `registry.modelcontextprotocol.io` 读取官方 server 列表与 package metadata。 |
| Smithery | 搜索 Smithery server，并尝试解析 install draft 或 manual draft。 |
| Glama | 搜索 Glama MCP server 列表。 |

Registry card 会被归一化为统一的 `McpRegistryCard`，其中 `installDraft` 表示可直接生成 server config，`manualDraft` 表示需要用户手工补全。

## GUI/WebUI Parity 要点

| 区域 | 注意事项 |
|---|---|
| Skills Hub | GUI/WebUI 都有 installed/store、preview drawer、install job 状态和 installedBySlug 推导。 |
| MCP Hub | GUI/WebUI 都有 server form、registry browser、preview drawer、install draft。 |
| i18n | 双端有各自 `i18n/config.ts`，新增文案要同步。 |
| settings sync | Skills/MCP settings 从 GUI 经 Gateway 同步到 WebUI，WebUI 修改再回写 GUI。 |
| shims | WebUI 的 Tauri invoke 实际走 Gateway，不应假设浏览器有本地权限。 |
