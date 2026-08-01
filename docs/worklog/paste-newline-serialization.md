# 工作记录 — 粘贴换行序列化与用户消息渲染

> 用途：承接本任务跨对话上下文。每次恢复先读「恢复指令」，再在指定 worktree 中核对 `git status` 与当前 HEAD。

## 恢复指令（覆盖式，永远只反映此刻）

- **总目标**：在桌面 GUI 与 Gateway WebUI 中保持粘贴、编辑、发送、历史/重连恢复和用户消息气泡渲染的逻辑换行数量与位置一致，同时不改变其他消息类型的 Markdown 语义。
- **当前任务**：用户已明确回复“通过”；正在固化公开截图、暂存/提交本任务文件，随后推送、创建上游 Issue/PR 并收敛 required CI。
- **上一个完成的动作**：用 GUI/WebUI 实际生产模块 fixture 生成两张公开截图，均显示 ClipboardEvent、composer、outbound、history 与 bubble DOM 的逻辑换行计数为 2，气泡为 3 个视觉行且无放大空隙，并显示 history/reconnect replay 通过；用户人工验收结论为“通过”。
- **下一步第一个动作**：执行最终范围/敏感文件/生成物审计，只暂存本任务源代码、测试、mirror manifest 和 worklog，复核 staged diff 后提交。
- **当前假设/约束/待确认**：只允许在 `D:\Documents\Projects\Web\LiveAgent\target\codex-paste-newline-serialization-worktree` 工作；不改 Rust、Go、数据库、协议或依赖，除非数据证据证明纯前端不足并先报告；用户验收通过前不 commit、push、创建 Issue/PR 或改远端状态。

## 未提交改动 & 验证边界

- **最近 checkpoint commit**：无。
- **未提交的改动**：双端 composer/newline helper/发送/用户消息渲染与局部用户气泡 CSS；双端 Node pipeline 测试；双端 Vite/Playwright 浏览器 fixture；`mirror-manifest`；相关旧 trim/SSR 断言；本 worklog。临时日志和基线副本已移动到 worktree 内 Git-ignored 的 `target/paste-newline-artifacts/`。
- **已验证**：分支/基线隔离；双端 build/typecheck；定向与全量测试（含基线对照）；定向 lint；全量 lint 逐项基线对照；Mirror Check；`git diff --check`；真实 Chromium 生产模块 pipeline、CSS 高度、undo/redo、reload/reconnect 与双端交叉 replay；独立只读审查。
- **未验证**：提交、push、上游 Issue/PR 与 required CI 终态。

## 复现与数据链路证据

- Chromium 基线探针使用真实 `DataTransfer` + `ClipboardEvent("paste")`，同时提供 `text/plain` 与 `text/html`；产品行为只读取 plain。
- `alpha\n\nbeta`：clipboard 2 个逻辑换行；paste DOM 为 `alpha<div><br></div><div>beta</div>`；composer/outbound/history/bubble 均为 `alpha\n\n\nbeta`（3 个换行）；`white-space: pre-wrap` 下内容高度 96px，而保真文本应为 72px。
- `alpha\n\n\nbeta`：clipboard 3 个换行，composer/outbound/history/bubble 变为 5 个，高度 144px。
- `\nalpha\n`：composer 先放大为 4 个换行，发送 `.trim()` 后首尾换行全部消失。
- ` \n\n `：composer 从 2 个换行放大为 3 个，发送 trim 后为空并拒绝发送；草稿结构本身也已错误。
- Markdown/Unicode 探针同样只在原有空行位置放大；JSON history/replay 本身原样保留传入字符串，没有新增换行。
- 修复后 GUI/WebUI 生产模块浏览器 fixture 均记录：clipboard、composer、outbound、history、bubble 的 newline count 完全一致；`alpha\n\nbeta` 为 2/2/2/2/2，bubble `white-space=pre-wrap`、内容高度 70.6875px、3 个视觉行（两行文字 + 一个空行）。
- Chromium 视觉探针确认 `pre-wrap`、`break-spaces`、`pre-line` 都保留 `alpha\n` 的 DOM 文本，却不会为末尾 LF 分配第二个行盒；空 span 无效，文本零宽空格虽有效但会污染 `textContent`。局部 `aria-hidden` 空 span 的 CSS `::before` 零宽字符可生成末尾行盒，同时保持 bubble DOM 文本精确等于消息内容。
- 修复后覆盖实际 `ClipboardEvent`、同时含 `text/html`、手工 Shift+Enter、undo/redo、reload/reconnect、GUI→WebUI、WebUI→GUI；`<tag>&` 被安全编码为 DOM `&lt;tag&gt;&amp;`，逻辑文本往返不变；40,002 字符长文本各阶段长度和 2 个换行一致。

## 根因

- 已确认主根因：浏览器对 multiline `execCommand("insertText")` 生成空 `DIV > BR`；`collectDraftSegments` 对该空块既添加 DIV/P 块边界换行，又把内部 BR 计为换行，因此每个空行多插入一个 `\n`。
- 已确认第二根因：GUI `useSendChatTurn.ts`、WebUI `GatewayApp.tsx` 与双端 `buildUserMessageContentWithUploads` 对完整用户文本调用 `.trim()`，会删除合法首尾逻辑换行并造成双端/阶段语义不清。
- 已确认第三个独立浏览器渲染边界：即使 raw text 精确保留末尾 LF，CSS `white-space` 也不会自动生成最后一个空行行盒；这是仅影响末尾换行的视觉折叠，不是 transport 或 serializer 数据丢失。
- 已排除：transport、optimistic transcript、JSON history/replay 没有换行 replace/trim；用户气泡不走 Markdown，而是 raw text + `white-space: pre-wrap`，所以普通空行放大的主因是上游已损坏的换行。段落 margin 不是本问题根因。

## 设计不变量

- CRLF 与 CR 可以在一个明确边界规范为 LF，但不得增加、删除或移动逻辑换行。
- 输入、发送和渲染不得分别执行可叠加的换行扩增转换。
- 手工输入与粘贴得到相同逻辑文本时，payload 与渲染必须相同。
- 用户消息的纯文本换行/块间距策略必须局部生效；assistant、thinking、tool、AskUserQuestion、TodoWrite 和 system 的 Markdown 语义保持不变。
- GUI、Gateway WebUI 与桌面共用 React 路径保持相同数据和视觉不变量。
- 保留消息 identity、顺序、虚拟化、滚动跟随、composer 布局和任务进度指示器。
- 不用 `trim()`、全局空白折叠、固定高度、隐藏溢出或 O(n²)/同步全量 DOM 遍历掩盖问题。
- `normalizeLogicalLineEndings` 是唯一换行语义模型：仅把 CRLF/CR 变为 LF，线性时间、幂等、不 trim；输入、草稿、发送和旧 history 显示调用同一模型，不再各自发明转换。
- multiline plaintext paste 使用经过 `&<>` 转义的单次 `execCommand("insertHTML")`，literal LF 在 `white-space: pre-wrap` 下显示并进入同一 undo stack；不支持时回退 `insertText`，而 block-aware serializer 可正确读取其 DIV/P/BR DOM。
- serializer 将块级节点视为逻辑行单元，空 `DIV/P > BR` 中的 BR 只作为占位，不再与块边界重复计数；mention/chip 与换行交错有双端行为测试。
- 仅当用户消息规范化文本以 LF 结尾时，追加不参与可访问文本和 `textContent` 的 `chat-user-trailing-newline-anchor`；其 `::before` 只负责生成浏览器遗漏的末尾行盒，不改变 assistant/tool Markdown、payload 或历史内容。

## 验证结果与基线失败

- 修复前真实浏览器：LF/CRLF/CR、单/多空行、首尾换行、纯空白、Markdown、Unicode/emoji 均已执行；空行放大和 trim 丢失稳定出现。
- 修复前 GUI 定向：`node crates/agent-gui/test/chat/paste-newline-pipeline.test.mjs`，2/2 失败；核心差异 `actual 'alpha\n\n\nbeta'` vs `expected 'alpha\n\nbeta'`。
- 修复前 WebUI 定向：`node crates/agent-gateway/test/webui/paste-newline-pipeline.test.mjs`，2/2 失败；差异与 GUI 一致。
- 首次定向运行因新 worktree 缺 `node_modules` 未到断言；随后分别执行 frozen-lockfile install，未修改依赖声明或 lockfile。
- 修复后新增 pipeline：GUI/WebUI 合计 10/10；最终 pipeline + GUI 用户消息 SSR 定向合计 24/24；覆盖 LF/CRLF/CR、无/单/多空行、首尾换行、纯空白、Markdown 段落/列表/引用/代码块/表格、Unicode/emoji、长文本、HTML-like plaintext、mention chip 和末尾视觉行锚点。
- WebUI 全量：498/498。
- GUI 全量：1421 tests，1416 pass，5 fail。5 个失败均在 `upstream/main@7de95a20...` 的 Windows checkout 基线逐项复现：2 个 `mention-composer-selection`、2 个 `mention-refetch` 因测试只识别 LF 函数结尾，1 个 provider usage preset 因 Rust/TS byte-for-byte 基线差异。
- GUI/WebUI build/typecheck：均通过。
- 全量 lint：当前 GUI `checked=429 errors=425 warnings=358 infos=9`，基线 `checked=428 errors=428 warnings=358 infos=9`；当前 WebUI `checked=297 errors=293 warnings=310 infos=10`，基线 `checked=296 errors=296 warnings=310 infos=10`。本任务新增文件无诊断，并修复了 6 个新增 import-order 诊断；剩余全为基线。
- 定向 `biome lint`：双端本任务 src 文件 exit 0；Mirror Check 120 files passed；`git diff --check` passed。
- 真实浏览器命令：两个 Vite fixture 分别绑定 127.0.0.1:1431/1432，使用 `npx --package @playwright/cli playwright-cli ... verify-paste-newline-pipeline.playwright.js`；全部断言通过，含 `alpha\n` 两个视觉行与 `\nalpha\n` 三个视觉行，控制台 0 error/0 warning，服务随后按 PID 关闭。
- 独立审查：无高/中确定性问题；补充的 `<>&`、mention/newline 与 fallback DOM 覆盖均已加入。

## 开放 PR 重叠

- #158、#276 直接修改双端 `MentionComposer.tsx`，与本任务存在真实文件冲突风险；未 cherry-pick、未建立依赖、未改写其提交。
- #350、#345、#281、#184 与 transcript/ChatPage/重连区域相邻或部分文件重叠，但本任务没有触碰其 assistant/virtualizer/row-model/Go ingress 实现。
- 其余开放 PR 未发现用户换行 serializer/user bubble 的直接重叠；本任务保持 `Depends-On: none` 假设，创建 PR 前需重新核对。

## 恢复说明

- 服务启动前必须检查 1420 端口及 `liveagent.exe`/Vite PID；不得复用或终止其他 worktree 的进程。
- Tauri 与 Gateway/WebUI 必须从本 worktree 的同一 HEAD 启动并核验路径。
- 用户明确回复“通过”之前，不得提交或修改远端状态。

## 同 HEAD 运行时验收环境

- 启动前 1420 为空；已有 2026-07-31 的 `pnpm ... tauri dev -> pnpm install` 残留树无监听端口，未终止、未复用。旧滚动任务的 Gateway/WebUI 位于 18080/15173，未触碰。
- Tauri：本任务 Vite PID 80608 监听 `127.0.0.1:1420`，命令行脚本路径位于本 worktree；`liveagent.exe` PID 30896 的可执行路径为本 worktree `target/debug/liveagent.exe`。首次同源码 Rust build 747/747，约 5m05s，窗口响应正常。
- Gateway：PID 68092 监听 `127.0.0.1:15052`；显式 token `paste-newline-acceptance-7de95a20`，独立 DB 位于 worktree ignored runtime 目录；日志确认 HTTP listening。
- Gateway WebUI：Vite PID 42216 监听 `127.0.0.1:15174`，命令行中的 Vite 源路径位于本 worktree；`npm_config_proxy_api=http://127.0.0.1:15052`。Vite HTML 返回 200 且包含 `/@vite/client`；Gateway 根路径返回 200 并引用本 worktree build 生成的 hashed assets。
- Playwright headed 浏览器以 token 成功进入 WebUI；当前唯一 console error 为 4 次 `No Agent is available`，与 Gateway 独立 DB 尚无桌面 Agent 完全一致，不是换行实现错误。浏览器证据已移到 ignored `target/paste-newline-artifacts/runtime/playwright-webui-initial/`。
- `PrintWindow` 离屏截图成功捕获当前 Tauri 窗口，证明窗口来自同 worktree 且响应正常；有效文件为 ignored `target/paste-newline-artifacts/runtime/screenshots/tauri-printwindow.png`。一次被其他置顶窗口遮挡的无效屏幕拷贝已隔离到 `screenshots/invalid/`，不得作为验收证据。
- Tauri 构建曾因只更新 `src-tauri/Cargo.toml` 的文件时间戳而让 `git status` 短暂显示 `M`；working-tree blob 与 `HEAD` blob 均为 `ab3fee0279334f9ab3f48cb783be464b61813af6`，文本 diff 为空，刷新索引后该状态消失。没有修改或恢复该文件内容，主工作区同名受保护文件始终未触碰。
- 桌面 GUI 本身即 Gateway Agent；设置页启用 Remote/Gateway，地址 `http://127.0.0.1`、端口 `15052`、token 如上后连接 `ws://127.0.0.1:15052/ws/v2/agent`，无需另起 agent 进程。Agent ID 由本地设置自动生成并持久化；为避免静默覆盖用户现有远程设置，等待用户在 UI 中确认并填写。
- 只读调查 Tauri 自带 MCP Bridge：raw WebSocket `list_windows` 可确认主窗口 `http://localhost:1420/`，但 Windows `execute_js` 回调被当前 capability 拒绝（日志：`mcp-bridge.script_result not allowed`）并稳定超时；因此停止自动 DOM/点击路径，不修改 capability 或应用源码。桥接脚本仅曾导航到设置页，截图确认已有持久化 Remote token/Agent ID/自动重连配置，未读取密码字段、未填写、未保存或覆盖。
- 调查期间用户窗口退出，1420/9223 随之停止；Gateway/WebUI 15052/15174 始终正常。重新预检端口后从同一 wrapper/HEAD 构建 747/747 并启动新 `liveagent.exe` PID 71616、Vite PID 30376，路径仍为本 worktree。后续人工验收不再使用 Bridge 注入。
- 重启后 Tauri PID 71616 到 Gateway PID 68092 建立两条 `127.0.0.1` established 连接；Gateway 日志记录真实 `chat.submit` 已送达 Agent，随后因窗口退出以 `terminal_cancelled` 收敛。Playwright 再登录 WebUI 时 Agent 状态为 `在线`，可读取桌面工作空间与历史，代理链路不再是阻塞；快照存于 ignored `target/paste-newline-artifacts/runtime/playwright-agent-connected/`，包含用户既有会话内容，不得作为 PR 公共截图。

## 人工验收与公开截图

- 2026-08-01：用户按验收矩阵完成测试并明确回复“通过”；因此提交/远端门禁解除。
- 用户回复后立即尝试捕获 Tauri 当前窗口，但窗口仍停在既有 TodoWrite 会话，没有显示换行样例；该文件 `acceptance-tauri-final.png` 不作为 PR 证据，也不对既有会话做自动切换或发送。
- 公开证据改由已通过的实际生产模块 fixture 生成，不修改产品源码、不触发模型调用：
  - GUI：`target/paste-newline-artifacts/runtime/screenshots/acceptance-gui-pipeline-2026-08-01T01-30-28-742Z.png`
  - Gateway WebUI：`target/paste-newline-artifacts/runtime/screenshots/acceptance-webui-pipeline-2026-08-01T01-31-45-337Z.png`
- 两张截图逐张人工检查：均显示 `alpha\n\nbeta` 在 Clipboard、Composer、Outbound、History、Bubble DOM 五阶段为 2 个换行；composer 与发送后气泡各显示一个普通空行；气泡 `white-space=pre-wrap`、3 个视觉行；`reload\n\nreconnect` replay 显示相同单空行。
- 截图后只终止本 worktree 的 fixture Vite PID 70764/66684，并确认 1431/1432 关闭；Tauri/Gateway/WebUI 1420/15052/15174 保持运行。Playwright 临时状态移入 ignored `playwright-public-evidence/`。

## 关键决策（只增不删）

- 2026-08-01：使用用户预建的分支、worktree 和固定基线，不另建分支、不切换基线。
- 2026-08-01：目标 worktree 没有 `.codegraph/`；遵守项目规则跳过 CodeGraph，不在该 worktree 自动创建索引，也不借用主工作区索引。

## 历程（按时间正序追加）

### 2026-08-01 — 任务启动与隔离门禁

- 做了：读取全局规则、项目规则和匹配 skills；创建 Goal；核对 worktree 分支与基线；fetch 并确认 `upstream/main` 未漂移；建立本 worklog。
- 验证：修改前 `git status --short --branch` 仅显示 `## codex/fix-paste-newline-serialization`，HEAD 与 `upstream/main` 均为固定基线 SHA。
- 遗留：开放 PR 重叠检查、数据链路探索、修复前自动化复现、实现和完整验证。

### 2026-08-01 — 数据链路与修复前失败证据

- 做了：并行定位 composer、transport/history、用户气泡与测试基础设施；只读检查全部开放 PR；用真实 Chromium 记录 clipboard、DOM、draft、payload、history、bubble 与实际高度；新增双端行为测试。
- 验证：GUI/WebUI 新测试均稳定在同一空行放大断言失败；真实浏览器确认含 `text/html` 时仍按 `text/plain` 处理。
- 遗留：实现规范化插入和无 trim 的发送边界，补真实浏览器修复后脚本以及完整回归。

### 2026-08-01 — 实现、浏览器集成与自动化收敛

- 做了：新增镜像 `composerText.ts`；改为安全、可撤销的 literal-LF paste；重写 block-aware serializer；移除完整用户文本 trim；历史用户内容使用同一换行模型；新增 Node 与真实浏览器双端 pipeline；更新 mirror manifest 和 worklog。
- 验证：双端 build、focused tests、WebUI 498/498、GUI 1415/1420（5 项基线复现）、Mirror Check、diff check、真实浏览器/undo/redo/reload/reconnect/cross-client 均已收敛。
- 遗留：启动同 HEAD Tauri 与 Gateway/WebUI，等待用户人工验收；通过前不提交或改远端。

### 2026-08-01 — 末尾 LF 视觉行收敛

- 做了：用 Chromium 独立比较 `pre-wrap`、`break-spaces`、`pre-line`、空 span、文本零宽字符和 CSS 伪元素；在双端用户消息组件加入仅末尾 LF 出现的 `aria-hidden` 空锚点与局部 CSS，并增加 SSR 与实际高度断言。
- 验证：生产组件浏览器 fixture 中 `alpha\n` 精确保留 DOM 文本且显示 2 个视觉行，`\nalpha\n` 显示 3 个视觉行；最终 GUI 1416/1421（相同 5 项基线失败）、WebUI 498/498、双端 build、定向 lint、全量 lint 基线对照、Mirror Check 与 diff check 均完成。
- 遗留：启动同 HEAD Tauri 与 Gateway/WebUI，采集人工验收截图并等待用户明确“通过”。

### 2026-08-01 — 同 HEAD Tauri/Gateway/WebUI 启动

- 做了：预检 1420 与所有相关 PID；从本 worktree 设置 libclang 并完整构建/启动 Tauri；使用独占 15052/15174 和独立 DB 启动 Gateway/WebUI；核验四个核心进程的命令行、可执行路径、监听端口与静态资源；用 Playwright 登录 WebUI并用 `PrintWindow` 捕获真实 Tauri。
- 验证：Tauri Vite/EXE 均来自本 worktree，Gateway/WebUI 日志和 HTTP 200 正常，WebUI proxy 指向本任务 backend；桌面窗口响应正常。未复用或终止任何其他 worktree 进程。
- 遗留：用户在桌面设置中启用本任务 Gateway Agent，执行双向消息、恢复/重连与视觉矩阵并明确回复“通过”；通过前仍不提交或改远端。

### 2026-08-01 — 用户验收通过与证据固化

- 做了：收到用户明确“通过”；捕获当前 Tauri 后发现未显示目标样例，拒绝将无关画面作为证据；随后从 GUI/WebUI 实际生产模块 fixture 重新执行粘贴、序列化、history/reconnect replay 并生成两张公开截图。
- 验证：双端截图五阶段换行计数一致，空行视觉高度一致；公开截图无用户既有会话内容。只关闭本任务 1431/1432 fixture，三端人工环境仍在。
- 遗留：最终 staged 审计、commit/push、上游 Issue/PR、required CI 收敛。
