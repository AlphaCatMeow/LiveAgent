# v2-kbrian 与 main 功能测试报告

- **测试日期**：2026-10-05（Asia/Shanghai）
- **测试仓库**：LiveAgent
- **测试提交**：`d92415c0704d7698e1857cbc0ab306814badd277`
- **测试分支**：`v2-kbrian`（当前工作区为 detached HEAD，提交与 `origin/v2-kbrian` 一致）
- **对比基准**：`origin/main`，当前 main 比 v2 多 19 个提交；v2 比 main 多 38 个提交
- **报告目的**：验证 main 已有功能在 v2 分支是否存在、可测试、可用，并列出不能使用或尚未补齐的功能。

## 结论

v2 当前可以通过大部分已有自动化测试，但**不能判定为完全具备 main 的全部功能**。主要结论如下：

1. LiveAgent GUI 全量 Node 测试：`2867` 个测试中 `2865` 通过、`2` 个失败。
2. Gateway Go 测试：全部通过。
3. K-brain `go test ./...`：全部通过。
4. Gateway WebUI 测试：`285` 通过、`0` 失败。
5. Gateway Web 端测试：`475` 个中 `474` 通过、`1` 个失败。
6. main 新增的日程、公开地址隧道、SSH 复用和压缩回归相关测试文件在 v2 中缺失，相关功能不能按 main 的测试标准判定为已补齐。
7. v2 本地缺少 `k-brain` Tauri 运行时二进制，因此不能完成桌面应用构建和真实 K-brain 端到端验证。
8. 浏览器交互验证未执行：当前环境没有可用浏览器验证工具。

## 测试结果汇总

| 测试项 | 结果 | 说明 |
| --- | --- | --- |
| LiveAgent GUI 全量前端 Node 测试 | ⚠️ 部分失败 | 2865 通过，2 失败 |
| LiveAgent Gateway `go test ./...` | ✅ 通过 | Gateway、HTTP、WebSocket、隧道等 Go 测试通过 |
| K-brain `go test ./...` | ✅ 通过 | K-brain 所有 Go 包通过 |
| Gateway WebUI Node 测试 | ✅ 通过 | 285/285 通过 |
| Gateway Web 端 Node 测试 | ⚠️ 部分失败 | 474/475 通过 |
| 发布/脚本测试 | ✅ 通过 | 41/41 通过 |
| LiveAgent UI TypeScript 检查 | ❌ 失败 | 当前 TypeScript 检查报 4 个类型错误 |
| Biome 全量检查 | ❌ 失败 | 2 个格式错误，1 个 hook 依赖警告 |
| Tauri 桌面构建/测试 | ❌ 阻塞 | 缺少 `crates/agent-gui/src-tauri/binaries/k-brain-aarch64-apple-darwin` |
| 浏览器端到端验证 | ⏸ 未执行 | 当前环境没有可用浏览器工具 |

## main 新增功能逐项核对

### 1. MCP 新版协议兼容与旧协议回退

- **main 提交**：`8e8cf46f`
- **v2 状态**：代码入口存在，GUI MCP 管理工具相关测试可运行；但没有专门覆盖新版协议“探测失败后回退 `initialize` 握手”的 Tauri 集成测试。
- **结果**：⚠️ **自动化覆盖不完整**。
- **补齐建议**：增加 Rust 集成测试，分别覆盖新版探测成功、探测失败回退、旧协议服务端和错误响应。

### 2. Markdown 删除线规则

- **main 提交**：`8959a5f2`
- **v2 状态**：功能和测试文件均存在。
- **专项结果**：`5/5` 通过；单个 `~` 保持普通文本，`~~text~~` 正常删除线。
- **结果**：✅ **可用**。

### 3. macOS 窄窗口侧栏标题栏避让

- **main 提交**：`ee8ff00f`
- **v2 状态**：对应 UI 代码存在，但没有针对 macOS 窄窗口和标题栏红绿灯区域的自动化测试。
- **结果**：⚠️ **代码存在，未验证**。
- **补齐建议**：使用桌面端截图或浏览器/窗口自动化覆盖窄窗口、宽窗口和侧栏浮层状态。

### 4. 消息时间戳智能显示年月日

- **main 提交**：`fb62575b`
- **v2 状态**：共享 UI 代码中未发现对应 main 版本的时间戳改动，也没有对应专项测试。
- **结果**：❌ **v2 未补齐/不可判定可用**。
- **补齐建议**：移植时间戳显示逻辑，并覆盖今天、昨天、跨年、不同 locale 和时区。

### 5. 同类型供应商模型列表缓存隔离

- **main 提交**：`a51fc99b`
- **v2 状态**：供应商模型请求代码和测试入口存在。
- **专项结果**：相关模型刷新/缓存测试在 Gateway WebUI 中通过；GUI 全量测试未因该功能单独失败。
- **结果**：✅ **逻辑可用，但类型检查仍失败**。

### 6. Relay 模型日期后缀匹配模型目录

- **main 提交**：`ab388c2b`
- **v2 状态**：模型目录代码和测试文件存在，已包含在 GUI 全量测试中。
- **结果**：✅ **可用**。

### 7. 供应商模型列表一键清空

- **main 提交**：`419ae859`
- **v2 状态**：没有对应 main 提交带来的清空功能变更和专项测试。
- **结果**：❌ **v2 未补齐/不可用**。
- **补齐建议**：补上“无搜索条件清空全部、搜索条件只清除匹配项、取消操作不保存”的实现和测试。

### 8. Memory 未审核筛选

- **main 提交**：`4b211fe3`
- **v2 状态**：Memory 页面代码存在，但没有发现对应的 `unreviewed-only` 筛选实现或专项测试。
- **结果**：❌ **v2 未补齐/不可用**。
- **补齐建议**：增加筛选状态、空状态、分页/刷新后保持状态和中英文文案测试。

### 9. Windows Node 测试批处理

- **main 提交**：`a6ff213f`
- **v2 状态**：`scripts/run-node-tests.mjs` 的 Windows 批处理改动不在 v2；脚本单元测试通过，但不能据此证明 Windows 上可用。
- **结果**：⚠️ **跨平台能力未补齐**。
- **补齐建议**：移植批处理逻辑，并在 Windows CI 上执行脚本测试。

### 10. Windows worktree 路径规范化

- **main 提交**：`8bd6bc30`
- **v2 状态**：对应 Rust 路径改动未纳入 v2；现有部分路径单测通过，但不是该功能的完整回归。
- **结果**：❌ **Windows worktree 功能未补齐**。
- **补齐建议**：移植路径规范化实现，覆盖盘符、反斜杠、UNC 路径和 Git worktree。

### 11. 上下文压缩回归修复与新压缩架构

- **main 提交**：`7d3839ff`、`79c3ac35`
- **v2 状态**：v2 已包含部分压缩代码和测试，但 main 新增的 `compaction-binding`、`compaction-bridge`、`compaction-checkpoint`、`compaction-prompt`、`compaction-summarize`、`compaction-transcript` 等测试文件在 v2 缺失。
- **已有专项结果**：v2 现有压缩专项测试通过。
- **结果**：⚠️ **基础逻辑可用，main 的完整回归覆盖未补齐**。
- **补齐建议**：移植 main 缺失测试，重点验证缓存共享 fork、流式降级、取消、文件 ledger 和压缩后继续对话。

### 12. 隧道公开地址端口与动态资源路径

- **main 提交**：`dc892311`
- **v2 状态**：Gateway 侧部分隧道代码和 `tunnel-runtime.test.mjs` 存在，但 GUI 的 `gateway-public-url` 专项测试及 main 对应的完整联动代码不在 v2。
- **专项结果**：Gateway WebUI 隧道相关测试通过。
- **结果**：⚠️ **Gateway 局部可用，GUI 端到端功能未补齐**。
- **补齐建议**：补齐公开 URL 生成、端口重写、动态资源路径和 GUI 发送消息联动测试。

### 13. 日程：日历、任务、图层、导入和 Cron

- **main 提交**：`75d582c5`
- **v2 状态**：日程 Rust/前端部分代码存在，但 main 新增的 `planning.test.mjs`、`planning-cron.test.mjs`、`planning-import.test.mjs`、`planning-layers.test.mjs` 测试文件在 v2 缺失。
- **结果**：❌ **无法按 main 标准确认可用，功能测试未补齐**。
- **补齐建议**：移植四组测试，并执行日历月/周视图、任务、图层、ICS 导入、重复事件和 Cron 同步验证。

### 14. SSH 同主机连接复用

- **main 提交**：`a4895c46`
- **v2 状态**：SSH 工具测试入口存在，但 main 对 SSH session/channel 的 Rust 复用实现不在 v2。
- **结果**：❌ **连接复用未补齐**。
- **补齐建议**：移植 session cache、并发复用、断线重连、不同主机隔离和资源释放逻辑，并补充 Rust 回归测试。

## 已确认的问题

### P0：类型检查失败

使用仓库锁定的 TypeScript 5.4.5 执行类型检查时报 4 个错误：

```text
crates/agent-gui/src/lib/kbrain/turn.ts:244:27
crates/agent-gui/src/lib/providers/runtime/textOnlyRuntime.ts:25:65
crates/agent-gui/src/lib/settings/storage.ts:704:28
crates/agent-ui/src/lib/settings/index.ts:777:69
```

这些错误涉及 `HostedSearchBlock` 联合类型收窄、`PromiseSettledResult` 类型判断和 `unknown` 类型使用，当前不能宣称 TypeScript 检查通过。

### P0：GUI 全量测试失败

1. `crates/agent-gui/test/chat/conversation-thinking.test.mjs`
   - 断言认为会话模型选择不应修改全局默认值。
   - 当前实际行为会把选择同步到设置。
   - 这是实现与测试预期不一致，需要明确产品行为后修复实现或更新测试。

2. `crates/agent-gui/test/skills/resource-http-adapters.test.mjs`
   - 缺少 `KBRAIN_RESOURCE_CONNECTION_FILE` 指向实时 K-brain 连接文件。
   - 这是环境阻塞，不能判定真实资源 round-trip 可用。

### P1：Gateway Web 测试失败

`crates/agent-gateway/web/test/provider-model-refresh-button.test.mjs` 失败，测试期望的 `canReuseStoredApiKey` 代码结构与当前实现不一致。需要确认行为仍然正确后更新实现或测试；在处理前不能将 Web 端测试标记为全绿。

### P1：代码质量检查失败

Biome 全量检查发现：

- `crates/agent-ui/src/pages/settings/CronTaskViewModal.tsx` 的 `useEffect` 有多余依赖 `refreshKey`；
- `crates/agent-gateway/web/src/lib/gatewaySocketTransport.ts` 存在未格式化代码；
- `crates/agent-gui/src/lib/kbrain/historyMigration.ts` 存在未格式化代码。

### P1：K-brain 运行时版本锁定

LiveAgent 的 `scripts/release/kbrain.lock.json` 仍锁定 K-brain `v0.107.3`，而 K-brain `main` 的旧模型回退修复提交为 `7604d22`。当前 beta 包中的 K-brain 二进制不一定包含该修复，需要发布新 K-brain artifact 后再更新锁文件并重新验证。

## 已通过的基础验证

- 发布脚本和 K-brain 打包校验：`41/41` 通过。
- LiveAgent Gateway：`go test ./...` 全部通过。
- K-brain：`go test ./...` 全部通过。
- Gateway WebUI：`285/285` 通过。
- Markdown 删除线专项：`5/5` 通过。
- v2 已有的压缩、Memory、MCP、模型目录、SSH 面板、隧道逻辑和路径测试大部分通过。

## 未完成验证

- 未执行浏览器真实交互验证：旧会话加载、删除模型、revision conflict 自动重试、日程页面、隧道公开地址、MCP 新旧握手、桌面端窄窗口和移动端布局。
- 未在 Windows 环境执行 Windows worktree、Node 测试批处理和路径回归。
- 未执行真实远程 SSH 复用测试。
- 未执行真实 K-brain resource round-trip，因缺少 live connection file。
- 未执行带 K-brain 二进制的 Tauri 打包测试。

## 修复优先级

1. 修复 TypeScript 4 个错误、GUI 1 个行为断言和 Gateway Web 1 个 API key 测试失败。
2. 补齐 main 缺失的日程、SSH 复用、Windows worktree、模型列表清空、Memory 未审核筛选和消息时间戳功能/测试。
3. 补充 revision conflict 自动重试、删除模型清理默认配置和 MCP 新协议回退的专门回归测试。
4. 发布包含 `7604d22` 的 K-brain artifact，更新 LiveAgent 的 K-brain lock，再重新打包 beta。
5. 在 macOS、Windows 和浏览器环境完成端到端验证。
