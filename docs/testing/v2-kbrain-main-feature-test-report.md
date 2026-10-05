# v2-kbrian 与 main 功能测试报告

- **测试日期**：2026-10-05（Asia/Shanghai）
- **测试仓库**：LiveAgent
- **测试提交**：`1105ae43540360e51d06f4b31ce24288507b0aad`（`v2-kbrian` HEAD，与 `origin/v2-kbrian` 一致）
- **对比基准**：`origin/main` HEAD `8e8cf46f`；共同祖先 `e63588a1`
- **提交差**：v2 领先 main `54` 个提交，main 领先 v2 `19` 个提交
- **K-brain 侧**：`main` HEAD `7604d22`，发布标签 `v0.107.4`
- **报告目的**：验证 main 已有功能在 v2 分支是否存在、可测试、可用，列出不能使用或尚未补齐的功能，并记录本轮修复。

> 本报告替代此前 `6091a16e` 版本。此前版本基于一个错误环境（混入 `typescript@5.4.5`）得出"TypeScript 4 个错误"的 P0 结论，并声明浏览器验证未执行；两者均已在本轮澄清。

## 结论

v2 当前**全部自动化测试通过、类型检查通过、代码质量检查通过**，并在真实浏览器中完成了端到端验证。

1. LiveAgent GUI 全量 Node 测试：`2902` 个测试，`2901` 通过、`0` 失败、`1` 跳过。
2. Gateway WebUI Node 测试：`475/475` 通过。
3. Gateway Go 测试：`go test ./...` 全部通过（21 个包）。
4. K-brain Go 测试：`go test ./...` 全部通过。
5. 发布/脚本测试：`42/42` 通过。
6. Tauri Rust 库测试：`1058` 通过、`0` 失败、`4` 忽略。
7. TypeScript 检查（仓库锁定的 TS `7.0.2`）：`agent-ui`、`agent-gui`、`gateway-web` 三个包全部 `0` 错误。
8. Biome 检查：`1015` 个文件，`exit 0`，无错误无警告。
9. 浏览器端到端验证：已执行，覆盖聊天收发、旧会话加载、编辑重发、Skills/MCP/定时任务/记忆/设置各页面、项目工具能力边界、桌面与移动两种视口。

**未补齐**的是三块体量较大的重写：日程（planning）、上下文压缩重构、以及一处上游缓存隔离修复（v2 已有等效实现，见下）。

## 测试结果汇总

| 测试项 | 结果 | 说明 |
| --- | --- | --- |
| LiveAgent GUI 全量前端 Node 测试 | ✅ 通过 | 2902 个中 2901 通过、1 跳过 |
| LiveAgent Gateway `go test ./...` | ✅ 通过 | 21 个包全部 ok |
| K-brain `go test ./...` | ✅ 通过 | 所有 Go 包通过 |
| Gateway WebUI Node 测试 | ✅ 通过 | 475/475 |
| 发布/脚本测试 | ✅ 通过 | 42/42 |
| Tauri Rust 库测试 | ✅ 通过 | 1058 通过、4 忽略 |
| TypeScript 检查（TS 7.0.2） | ✅ 通过 | 三个包均 0 错误 |
| Biome 全量检查 | ✅ 通过 | 1015 文件，无错误无警告 |
| K-brain 二进制与锁文件一致性 | ✅ 通过 | 8 个 artifact 的 sha256 与发布页 SHA256SUMS 一致 |
| 浏览器端到端验证 | ✅ 通过 | 见"浏览器验证证据" |
| Windows 实机验证 | ⏸ 未执行 | 无 Windows 环境；相关移植代码与脚本测试已在 macOS 通过 |

## 本轮修复

### 1. 旧会话报 "unknown model"（已修复并验证）

- **K-brain 提交**：`7604d22 fix(history): load sessions after model removal`
- **原因**：会话记录里保存的模型被删除后，`loadRuntimeByID` 直接按该模型解析供应商，找不到同厂供应商即 500。
- **修复**：解析失败时回退到 `fallbackModel()`。
- **证据**（同一会话 `78f0deea`，其记录模型 `third-model` 已从配置中删除）：

| 后端 | 版本 | `GET /v1/sessions/78f0deea/history` |
| --- | --- | --- |
| `127.0.0.1:47411` | v0.107.3 | **500** `no configured same-vendor provider for model "third-model"` |
| `127.0.0.1:47412` | v0.107.4 | **200** |

浏览器中打开该会话：历史与轨迹均 200、无页面错误；在其中继续发消息同样成功（GUI 使用当前模型胶囊，而不是会话里过期的模型）。

### 2. 删除模型后配置文件残留（已修复并验证）

- LiveAgent `crates/agent-gateway/internal/kbrain/settings.go:338` 在供应商被替换时清理过期默认值；K-brain `applySettings` 在当前 `(defaultProvider, defaultModel)` 不在投影中时重新选取默认值。
- 浏览器实测：供应商设置 → 编辑 Mock Relay → 删除模型 → 保存，`PUT` 返回 200、磁盘配置被重写、默认模型自动迁移到 `legacy/legacy-model`，旧会话历史仍为 200。

### 3. 对话 revision conflict 不再中断（已修复）

- **LiveAgent 提交**：`aab40bce fix(kbrain): reload history and unblock v2 checks`
- 新增 `isKBrainRevisionConflict`、`findReloadedMessageRef`、`reloadConversation`，接入 `replaceConversationAtMessage`、`loadEarlier`、`useBranchConversation`。
- 新增测试 `crates/agent-gui/test/chat/history-revision-conflict-reload.test.mjs`（8/8）。
- 浏览器实测编辑重发：`POST /v1/sessions/b4d9aa1e/branch`（201，分支创建）→ `POST /edit` → `POST /runs`，全程无冲突报错。

### 4. 桌面宿主能力缺失时不再泄漏内部诊断（已修复）

浏览器宿主（K-brain backend + WebUI）没有 `terminal_*` / `fs_*` / `git_*` / `gateway_tunnel_*` 这些桌面命令，之前每个项目工具入口各自把 Tauri 内部诊断（`Tauri command X is unavailable in K-brain browser mode`）直接渲染给用户。

- **提交**：`02416eea fix(ui): localise missing desktop-host capabilities`、`ad0fbb26 fix(ui): gate project tools behind desktop-host capability`
- `crates/agent-ui/src/lib/shared/hostErrors.ts` 新增 `hostAwareErrorMessage(error, unavailable, fallback)`：宿主能力缺失 → 调用方本地化文案；真实失败（权限/路径/网络）原样透出。
- `ChatPage` 拆分"用户可自行解决"（Agent 模式 / 选项目）与"当前运行面没有桌面能力"两类提示；浏览器宿主下项目工具整区标记不可用，头部按钮保持可点开。
- 内网穿透改为按宿主注入 client（`projectToolTunnelClient`），入口按能力置灰。
- 终端 / 文件树 / Git 审查 / SSH / 后台任务 / 内网穿透的每个 catch 全部走统一出口；Gateway WebUI 侧原先的英文硬编码同样接入 i18n。
- 新增 zh/en 文案：`desktopHostRequired`、`desktopTerminalOnly`、`runtimeUnsupported`、`settingsSyncing`、`webTerminalDisabled`、`webGitDisabled`、`collapsePanel`/`expandPanel` 等。

修复前实测（面板真实打开、1440×900）：

| 工具入口 | 修复前泄漏 | 修复后 |
| --- | --- | --- |
| 新建终端 | `Tauri command terminal_create is unavailable in K-brain browser mode` | 中文原因，无泄漏 |
| 新建文件树 | `Tauri command fs_list is unavailable in K-brain browser mode` | 中文原因，无泄漏 |
| 新建 SSH 连接 | `Tauri command terminal_ssh_local_forward_list is unavailable in K-brain browser mode` | 中文原因，无泄漏 |
| 新建审查 / 新建内网穿透 / 后台任务 | 无泄漏 | 中文原因，无泄漏 |

同一类问题在设置页里还有三处，本轮（`1105ae43`）一并修掉——这些入口只有点了按钮才会暴露，所以逐页遍历时容易漏掉：

| 入口 | 触发命令 | 修复前泄漏 | 修复后 |
| --- | --- | --- | --- |
| 关于 → 检查更新 | `app_update_check` | `Tauri command app_update_check is unavailable in K-brain browser mode` | 中文原因，无泄漏 |
| 关于 → 预览更新公告 | `app_release_announcement_preview` | `Tauri command app_release_announcement_preview is unavailable in K-brain browser mode` | 中文原因，无泄漏 |
| 备份与同步 | `settings_backup_load_sync_config` | `Tauri command settings_backup_load_sync_config is unavailable in K-brain browser mode` | 中文原因，无泄漏 |
| SSH → 导入 | `fs_roots` | `扫描失败: Tauri command fs_roots is unavailable in K-brain browser mode` | 中文原因，无泄漏 |

- `AboutSection.tsx` 删除本地 `errorMessage`，检查更新 / 查看公告 / 预览公告的 catch 改走 `hostAwareErrorMessage(error, t("settings.aboutDesktopHostRequired"))`。
- `BackupSyncSection.tsx` 的 `errorText(error)` 增加 `unavailableMessage` 参数并统一走 helper，覆盖读取配置、保存、上传、下载、导出、导入六条路径。
- `SshSection.tsx` 的导入扫描 catch 改走 `hostAwareErrorMessage(scanError, t("settings.sshImportDesktopHostRequired"))`。
- 新增 zh/en 文案 `settings.aboutDesktopHostRequired`、`settings.backupSyncDesktopHostRequired`、`settings.sshImportDesktopHostRequired`；新增回归测试 `crates/agent-gui/test/shared/host-command-unavailable.test.mjs` 两条（设置页出口 + 双语文案），该文件现为 `7/7`。

### 5. K-brain 运行时版本锁定（已完成）

- `scripts/release/kbrain.lock.json` 由 `555a920`/`v0.107.3` 更新为 `7604d22`/`v0.107.4`。
- 8 个 artifact 的 `sha256` 全部与发布页 `SHA256SUMS` 逐一核对一致。
- `scripts/prepare-kbrain.mjs --target aarch64-apple-darwin` 成功，产物 `-version` 输出 `k-brain v0.107.4`。

### 6. 发布

- LiveAgent `v2.0.0-beta.1` prerelease 已发布，指向 `2a60137a`，8 个资产复制自 `v1.3.8-beta.8`，未重新触发发布流水线。

## 从 main 移植的提交

以下提交已在本轮移植进 `v2-kbrian`（`-x` 保留来源信息，冲突处手工三方合并）：

| v2 新提交 | 来源 main 提交 | 说明 |
| --- | --- | --- |
| `3631760b` | `7659c306` | 刷新模型目录 |
| `30c133da` | `dc892311` | 修复公开地址端口与动态资源路径 |
| `b496d38e` | `6efdc218` | 文本文件跨平台保持 LF |
| `0cc2f346` | `8bd6bc30` | 规范化 Windows worktree 路径 |
| `1b702659` | `a6ff213f` | Windows 下分批执行 Node 测试 |
| `ef69b438` | `419ae859` | 供应商模型列表一键清空 |
| `4a153c66` | `ab388c2b` | Relay 模型 id 的月日后缀匹配 |
| `f6c9019b` | `ee8ff00f` | macOS 窄窗口侧栏为红绿灯让出标题栏高度 |
| `03eedfc2` | `8e8cf46f` | 兼容 2026-07-28 新版 MCP 协议，探测失败回退 `initialize` |
| `16fcaeba` | `fb62575b` | 消息时间戳智能显示年月日（保留 v2 分享弹窗与 rewind 改动） |
| `92567968` | `4b211fe3` | Memory 只看待审核筛选（保留 v2 `loading||error||backendManaged` 守卫） |
| `a650bc37` | —（新增） | 时间戳格式专项测试（5 个） |
| `aab40bce` | —（新增） | revision conflict 自动重载 + 锁文件更新 + 过期测试修正 |
| `02416eea` | —（新增） | 桌面宿主能力缺失本地化 |
| `ad0fbb26` | —（新增） | 项目工具按桌面宿主能力边界收口 |

## main 已有功能逐项核对

### ✅ 已确认可用

| 功能 | main 提交 | v2 状态 |
| --- | --- | --- |
| MCP 新版协议兼容与旧协议回退 | `8e8cf46f` | 代码与测试均在 v2；MCP 添加流程浏览器实测 `200 PUT /v1/mcp`（本轮复验列表为 `1/1 已启用`） |
| Markdown 删除线只认 `~~text~~` | `8959a5f2` | 专项 `5/5` 通过 |
| macOS 窄窗口侧栏避让 | `ee8ff00f` | 代码已在 v2；无自动化测试，未在 macOS 桌面端截图验证 |
| 消息时间戳智能显示年月日 | `fb62575b` | 已移植，专项测试 `5/5` 通过 |
| Relay 模型日期后缀匹配 | `ab388c2b` | 代码与测试均在 v2 |
| 供应商模型列表一键清空 | `419ae859` | 已移植，浏览器实测"清空"按钮存在（模型删除后配置清理已单独验证） |
| Memory 未审核筛选 | `4b211fe3` | 已移植，浏览器实测 `待审核` 筛选 `aria-pressed` false → true 且列表过滤生效 |
| Windows Node 测试批处理 | `a6ff213f` | 已移植；脚本测试通过，未在 Windows 实机执行 |
| Windows worktree 路径规范化 | `8bd6bc30` | 已移植；Rust 库测试 1058 通过 |
| 隧道公开地址端口与动态资源路径 | `dc892311` | 已移植；Gateway 隧道测试通过，GUI `gateway-public-url.test.mjs` 在 v2 存在 |
| SSH 同主机连接复用 | `a4895c46` | **已在 v2**：`ssh_session.rs`、`ssh_channel.rs` 与 main 逐字节一致；`sshManagerTools.ts` 仅 import 路径不同（v2 走 `@liveagent/app`）；`ssh-manager-tools.test.mjs` 20/20 通过，含 `session_reused` 断言 |
| 供应商模型列表缓存隔离 | `a51fc99b` | v2 经 K-brain `POST /v1/settings/providers/{id}/models` 取模型，代码已带 `cache:"no-store"`，Rust 代理 `Vary` 已含 `x-liveagent-upstream-origin` 并有 3 个 vary 测试；上游修复在 v2 已等效，无需移植 |
| K-brain 工作区树与迁移 | `6d359b11` | 浏览器实测工作空间页面正常 |
| 回答一键分享 | `8955764e` | 浏览器实测分享 UI 存在（`管理已分享会话（0）`、分享开关） |

### ❌ 未移植

#### 1. 日程（planning）

- **main 提交**：`75d582c5`（169 个文件、+23046/−279）
- **v2 状态**：main 新增的 `planning.test.mjs`、`planning-cron.test.mjs`、`planning-import.test.mjs`、`planning-layers.test.mjs`、`planning-tools.test.mjs` 在 v2 均缺失。
- **原因**：整块新功能，含日历/任务/图层/ICS 导入/Cron 同步，属于大型重写，本轮未纳入。
- **补齐建议**：整体移植后执行日历月/周视图、任务、图层、ICS 导入、重复事件与 Cron 同步验证。

#### 2. 上下文压缩重构

- **main 提交**：`79c3ac35`（93 文件、+8669/−5456）、`7d3839ff`（回归修复）
- **v2 状态**：v2 已有压缩实现与部分测试（`compaction-controller`、`compaction-file-ledger`、`compaction-policy`、`compaction-seam-row`、`compaction-token-ledger` 存在），但 main 新增的 `compaction-binding`、`compaction-bridge`、`compaction-checkpoint`、`compaction-prompt`、`compaction-summarize`、`compaction-transcript`、`compaction-abort`、`compaction-observer` 在 v2 缺失。
- **结果**：v2 基础压缩逻辑可用，main 的完整回归覆盖未补齐。
- **补齐建议**：移植缺失测试，重点验证缓存共享 fork、流式降级梯、取消、文件 ledger 与压缩后继续对话。

## 浏览器验证证据

环境：Vite dev server `localhost:1420`（`crates/agent-gui`）→ K-brain `127.0.0.1:47412`（v0.107.4，fixture `/tmp/la-fix/new`），Chrome headless CDP 驱动，视口 1440×900 与 420×860。

已实测通过（均为真实鼠标点击驱动，不是合成 `.click()`）：

- **聊天收发**：输入 → 发送 → 流式回复渲染（`echo: v2 sweep roundtrip … / Answer / This is streamed verification text.`），消息时间戳显示为 `22:36`；`1 轮 · 1 步`，`上下文 1%`。
- **打开旧会话**：`deleted-model history repro` 正常加载，历史与轨迹均 200，无页面错误。
- **轨迹视图**：点开「轨迹」标签后按轮次渲染（SYSTEM / USER / ASSISTANT + 工具行 + `1 ms` 耗时），点回「对话」正常。
- **编辑重发**：分支创建 201 → `/edit` → `/runs`，无冲突报错。
- **Skills 页面**：商店列表与分类筛选渲染正常（`全部 2`，其余分类 0）；功能总开关 `role="switch"` 实测 `false → true → false`；本地导入面板打开正常（Claude Code / Codex / CodeBuddy / Agent Skills 四个来源）。
- **MCP 页面**：已配置 `fixture-mcp`（STDIO）显示 `1/1 已启用`；「添加」菜单 → 对话框字段完整（Server Name / Transport / Timeout / Command / CWD / Args / Env / 描述 / 文档链接），实测新增 `v2-sweep-mcp` 后变为 `2/2` 并持久化。
- **定时任务**：新增任务 → 类型选择（Shell 脚本 / Http 请求 / Auto Prompt）→ Shell 表单（任务名称 / Cron / 描述 / 工作空间 / 脚本 / 超时）；实测保存 `v2 sweep task`（`0 0 3 * * *`）后列表显示 `1 个任务`，`GET /v1/cron` 返回同一任务，磁盘持久化。
- **记忆**：新建记忆对话框需要 **slug 输入框 + 正文 textarea**（只填正文会被拒绝）；保存后 `全局 1 / 500`，出现 `1 条记忆待审核` 横幅与「通过」按钮；点行选中 → 「通过」后横幅消失、条目转为已审核。
- **供应商设置**：五个供应商标签页（Anthropic / OpenAI / Gemini / Grok / DeepSeek）与卡片渲染正常；OpenAI 下两张卡片（Legacy Vendor / Mock Relay），行内「复制 Base URL 和 API Key / 编辑 / 删除」入口齐全；模型删除后配置清理已在上一轮验证。
- **设置各分区**：系统设置 / 供应商设置 / 提示词模板 / Skills / MCP / 定时任务 / 记忆 / Hooks / 系统工具 / Computer Use / 语音输入 / SSH / Remote / 快捷键 / 备份与同步 / 关于，`nav.settings-nav` 共 `16` 个入口，逐个点击全部渲染，无 console 错误。
- **设置页交互**：提示词模板「新增模板」、Hooks「新增 Hook」、MCP「添加」、WebDAV「设置同步」（服务商预设对话框）、备份「导出配置」均正常打开，无异常。
- **主题切换**：浅色（`aria-pressed=true`）→ 深色后 `documentElement.className` 变为 `dark`，切回浅色后为空。
- **Computer Use**：当前运行面提示为中文（"这个浏览器宿主背后没有桌面端"），无内部诊断。
- **项目工具能力边界**：面板真实打开（`data-state=open`、`inert=false`）后，「新建项目工具」按钮为 `disabled`，六个入口（终端、文件树、审查、内网穿透、SSH、后台任务）全部只显示中文原因，全页扫描无 `unavailable in K-brain` / `WebUI shim does not implement` 字样。
- **设置页泄漏扫描**：16 个设置分区 + 5 个侧栏页面逐页扫描，加上 关于/备份/SSH/Hooks/定时任务/记忆/Computer Use/语音输入/Remote 的主要按钮点击，修复后全为 0 泄漏。
- **移动端 420×860（deviceScaleFactor 2）**：应用正常渲染聊天与输入区，`innerWidth = 420`、`scrollWidth - clientWidth = 0`（无横向溢出），无 JS 错误；侧栏收为 Sheet（符合预期）。

## 与 zcode 前后端分离架构的对比

用户指定的参考实现为 `/Users/a/code/harness/zcode`（`zcode cli` 对应 k-brain，`zcode desktop` 对应 liveagent）。

### zcode 的结构

- pnpm monorepo，`packages/{rpc,services,shared,client,server,web,ui,desktop,…}` + `apps/zcode-cli`。
- `@zcode/rpc` 分 7 层：foundation（Emitter/Disposable）→ serialization → protocol → channels → ipc → proxy-channel → remote。
- `architecture-policy.yaml` 约束：`maxFileLines 400`、`maxContractLines 300`、`maxPublicMethods 12`、`forbidCycles`、`forbidDeepImports`，由 `scripts/architecture/architecture-check.mjs` 强制。
- `packages/server/src/{entry-stdio,stdio,entry-http,http}.ts`：同一服务端两种传输；stdio 把 `console` 重定向到 stderr，保证 RPC 帧干净。
- `packages/desktop/src/{main,host,renderer,preload,scheduler,shared}`：main 只做窗口与进程，host 是单窗口服务所有者。
- 客户端两种模式：`desktop-continuous`（在线）与 `web-remote-replayable`（可恢复），见 `packages/ui/src/v4/agentV4ConnectionHandshake.ts:41`。

### LiveAgent 现状

- 304 个 Tauri `invoke` 命令（`crates/agent-gui/src-tauri/src/lib.rs`）+ 13 条 K-brain HTTP 路由（`crates/agent-gui/src/lib/kbrain/client.ts`）+ 307 个 agent-gui TS/TSX、558 个 agent-ui、209 个 Rust 文件。

### 关键差异

1. **缺少统一的服务注册/依赖注入**：UI 直接调用宿主 `invoke`。本轮修掉的终端/CUA/Git 泄漏正是这个缺失的"能力边界"造成的。
2. **宿主 shim 实现重复且已漂移**：`crates/agent-gui/src/shims/tauriCore.ts` 与 `crates/agent-gateway/web/src/shims/tauriCore.ts` 各自维护一套。
3. **两种客户端模式未显式建模**：网关桥接是 continuous，WebUI 是 replayable，但没有像 zcode 那样在类型层面区分。

### 建议

- 引入能力注册表 + `isAvailable` 门控（`rightDockRegistry.tsx` 的 `isAvailable`/`RightDockToolCapabilities` 已是雏形）。
- 引入 zcode 式的架构检查门禁（文件行数、循环依赖、深层导入）。
- 把宿主能力缺失的处理集中到 `hostErrors` 这样的单一出口（本轮已开始）。

## 未完成验证

- 未在 Windows 实机执行 Windows worktree、Node 测试批处理与路径回归。
- 未执行真实远程 SSH 复用测试（无外部 SSH 主机）。
- 未执行带 K-brain 二进制的 Tauri 桌面打包与安装包冒烟测试。
- macOS 窄窗口标题栏避让无自动化截图比对。
- 桌面端（Tauri）专属能力本身未在桌面实机复测：本轮所有浏览器结论都来自 K-brain 浏览器宿主，验证的是"缺能力时不再泄漏诊断"，不是桌面端命令的行为。
- Gateway WebUI 未起实例：`gateway-web` 的 475 个 Node 测试通过，但没有像 GUI 那样做浏览器端到端点击。

## 后续建议

1. 移植日程（`75d582c5`）与压缩重构（`79c3ac35` + `7d3839ff`），补齐对应测试文件。
2. 在 Windows CI 上跑 worktree 与脚本回归。
3. 把"宿主能力缺失"的浏览器回归固化成自动化用例（当前只在项目工具面板有源码级断言），任何新入口都应走 `hostAwareErrorMessage`。
4. 在桌面实机跑一遍同样的设置页交互，确认本地化提示不会掩盖桌面端真实错误。
