# Memory 系统

## 总体模型

LiveAgent 的记忆系统由 Rust `MemoryStore` 作为本地真相源，前端提供 Settings 管理、Chat prompt 注入和 `MemoryManager` 工具访问。Gateway/WebUI 不拥有独立记忆库，只把 WebUI 的 memory 请求转发到桌面端。

| 层 | 路径 | 职责 |
|---|---|---|
| Rust Store | `src-tauri/src/services/memory.rs` | Markdown 文件读写、SQLite FTS 索引、搜索、quota、daily、organizer、audit。 |
| Tauri commands | `src-tauri/src/commands/memory.rs` | `memory_list/read/search/write/update/delete/accept/apply_batch/organize_*` 等前端调用入口。 |
| 前端 API | `src/lib/memory/api.ts` | GUI 调用 Tauri memory commands 的 TypeScript 封装。 |
| Chat prompt | `src/lib/chat/memory/memoryPrompt.ts` | 每轮构造 memory overview section 注入 system prompt。 |
| Silent extraction | `src/pages/chat/silentMemoryExtraction*.ts`、`src/lib/chat/memory/*` | 回合后自动识别候选记忆，解析四段协议并应用计划。 |
| Tool | `src/lib/tools/memoryTools.ts` | 对模型暴露 `MemoryManager`。 |
| Settings UI | `src/pages/settings/MemoryPanel.tsx`、WebUI 镜像文件 | Global/Project/Journal 管理、quota、organizer 设置、擦除/审核。 |
| Background runner | `src/components/memory/MemoryOrganizerRunner.tsx` | 执行自动整理记忆任务。 |

## 存储结构

| 数据 | 位置 | 说明 |
|---|---|---|
| Markdown 事实源 | `~/.liveagent/memory/...` | 记忆正文和 frontmatter 的 canonical source。 |
| SQLite index | `~/.liveagent/memory/memory-index.sqlite3` | `memory_meta`、`memory_fts`、`memory_fts_tri`、`memory_audit_log`。 |
| Settings | `~/.liveagent/config.sqlite` 的 `memory_settings` | 记忆功能开关、summary model、organizer schedule 等。 |
| Organizer history | MemoryStore 内部组织运行记录 | Settings Memory 可查看/清理历史。 |

## Scope 与类型

| 维度 | 值 | 说明 |
|---|---|---|
| scope | `global` | 跨项目用户偏好、身份事实、长期反馈。 |
| scope | `project` | 与当前 workdir 绑定的项目记忆。 |
| type | `user` | 用户身份、偏好、习惯。 |
| type | `feedback` | 用户对 Agent 行为的长期反馈。 |
| type | `project` | 项目知识、架构约定、工作流。 |
| type | `reference` | 可引用资料。 |
| type | `daily` | Journal/日记型记忆，scope 固定为 global，按日期 append。 |

Settings UI 将普通记忆分成 Global、Project，将 `daily` 作为 Journal 展示。

## Quota 语义

| 项 | 说明 |
|---|---|
| ordinary memory | 非 daily 的 global/project 记忆。 |
| quota 粒度 | Rust `memory_list` 返回 `scope_quotas`，按 global 和当前 project 分别统计。 |
| daily | 不计入 ordinary quota。 |
| UI 状态 | GUI/WebUI MemoryPanel 根据 `scope_quotas` 显示 Global/Project 使用量和阈值状态。 |

## 召回路径

| 路径 | 说明 |
|---|---|
| Overview 注入 | Chat 每轮调用 `memory_index_overview`，把高相关 global/project/daily 热记忆加入 system prompt。 |
| MemoryManager | 模型可显式 `list/read/search` 召回更多条目，必要时 mutation。 |
| Search | SQLite FTS5/BM25 与 trigram 辅助中文/短词检索，结果再按 scope、review、daily 衰减等排序。 |
| Project shadow | 当前项目记忆可在 overview 中覆盖同 slug/同语义 global 记忆。 |

## Unreviewed 与审核

| 状态 | 语义 |
|---|---|
| reviewed | 普通高可信记忆，可直接进入召回排序。 |
| unreviewed | 未审核但可用，overview 中单独标明为可通过对话自动审核。 |
| recent rejections | 用于 silent extraction 避免反复写入近期被拒绝的候选。 |
| accept | `MemoryManager` 或 Settings 可把 unreviewed 转成 reviewed。 |

## Silent Memory Extraction

| 阶段 | 说明 |
|---|---|
| 触发 | 主对话回合结束后，根据 settings 和模型选择运行。 |
| Prompt | `memoryPolicy.ts` 构造隐藏后处理提示，要求模型按四个 JSON block 输出识别、匹配、计划和最终状态。 |
| Tool 约束 | 隐式提取阶段允许读/list/search，但不允许模型直接 mutation。 |
| 应用 | LiveAgent 解析 plan 后通过 MemoryStore 执行 write/update/delete/accept。 |
| 可观测性 | agent-dev 模式可展示更完整的 silent memory 细节和 fallback。 |

## Gateway/WebUI 边界

| 场景 | 实现 |
|---|---|
| WebUI MemoryPanel | 通过 `memory.manage` 转发到桌面端。 |
| WebUI organizer | UI 与 GUI 保持一致，但实际 organizer 运行仍依赖桌面端。 |
| Project scope | WebUI 请求必须带 workdir，Gateway bridge 透传到 Rust，避免 project memory 失真。 |
| Wipe all | GUI/WebUI UI 都有确认层，实际清除由 Rust store 执行。 |

## 常见排障入口

| 问题 | 优先检查 |
|---|---|
| 记忆没有写入 | `silentMemoryExtraction` 是否触发、parse result、`memory_apply_batch`、MemoryStore audit log。 |
| 搜不到记忆 | `memory-index.sqlite3` 是否 reconcile、FTS 行是否存在、scope/workdir 是否正确。 |
| WebUI project memory 错位 | `memory.manage` payload 是否带 workdir，Gateway bridge 是否透传。 |
| quota 显示不对 | Rust `scope_quotas`、GUI/WebUI `MemoryPanel` 的 fallback 逻辑。 |
| daily 标题异常 | `daily_slug_local_date`、`daily_title_for_meta`、Settings Journal 渲染。 |
