# History 与 Context Compaction

## 历史持久化

| 数据 | 表/结构 | 说明 |
|---|---|---|
| Conversation header | `chatHistory` | id、title、created/updated、provider/model、session/cwd、message count、active segment、pin/share 状态。 |
| Segment | `chatHistorySegment` | conversation_id + segment_index 主键，保存 messages_json、summary_json、message window 元数据。 |
| Share | `chatHistoryShare` | public share token、enabled、redact tool content、timestamps。 |
| Segment FTS | `chatHistorySegmentFts` | 聚合 segment 文本检索。 |
| Message FTS | `chatHistoryMessageFts` | message 级检索。 |
| FTS index metadata | `chatHistoryFtsSegmentIndex` | 判断 FTS 是否需要刷新/回填。 |

Rust 实现位于 `src-tauri/src/commands/chat_history.rs`。

## V3 Segment 模型

| 概念 | 说明 |
|---|---|
| active segment | 当前继续追加消息的最新 segment。 |
| total segment count | 当前 conversation 的 segment 总数。 |
| summary checkpoint | 一个 segment 可带 `summary_json`，表示前序上下文压缩结果。 |
| append segment | 压缩后追加新 segment，旧 segment 保留但后续上下文通过 summary 引用。 |
| active segment upsert | 普通流式更新中更新当前 segment。 |
| truncate | 编辑重发或历史修剪时，从目标位置截断 segment/message window。 |

## 上下文压缩

| 阶段 | 输入 | 输出 |
|---|---|---|
| 预算估算 | 当前 conversation state、tools、model context window | 是否需要压缩或 prune。 |
| compaction request | 旧消息、已有 summary、tools context | summary assistant message。 |
| checkpoint 应用 | summary message + 被覆盖消息范围 | 新 segment 的 `summary_json` 和 transcript checkpoint。 |
| resume context | summary + 未覆盖 tail messages | 下一轮模型请求上下文。 |

相关前端路径包括 `pages/chat/conversationContextBuilders.ts`、`lib/chat/conversation/conversationState.ts`、`lib/chat/conversation/compaction/*`。

## FTS 搜索

| 机制 | 说明 |
|---|---|
| message-level FTS | 精确定位包含关键词的单条历史消息。 |
| segment-level FTS | 对 segment 聚合内容检索，适合跨消息信息。 |
| lazy refresh | 搜索前按 batch 刷新 stale segment，避免初始化时全量回填阻塞。 |
| time filter | 支持按时间窗口过滤，并有 time-window fallback。 |
| 去重 | FTS 结果需去除重复 segment rows，避免 UI 重复匹配。 |

## 分享历史

| 能力 | 说明 |
|---|---|
| enable share | 为 conversation 生成 token 并写 `chatHistoryShare`。 |
| disable share | 关闭 token，旧 token 不再 resolve。 |
| redaction | 可配置是否隐藏 tool content。 |
| public resolve | Gateway `/api/public/history-shares/{token}` 返回只读 transcript 数据。 |
| UI | GUI/WebUI sidebar 和 shared history manager 显示分享状态。 |

## Pin 与 Sidebar 排序

| 字段 | 说明 |
|---|---|
| `is_pinned` | 是否置顶。 |
| `pinned_at` | 置顶时间，用于置顶分组排序。 |
| `updated_at` | 非置顶或同组内 fallback 排序。 |

GUI/WebUI 的 sidebar 都依赖 summary 中的 pin/share 字段，因此新增历史字段时必须同步 Rust summary、proto、Gateway payload 和两端 UI。

## WebUI 大历史优化

| 优化 | 说明 |
|---|---|
| `max_messages` | WebUI `history.get` 可只请求 tail window。 |
| `has_more` | 响应中标记是否还有更早消息。 |
| `total_message_count` / `returned_message_count` | 让 UI 明确当前窗口范围。 |
| worker parser | 大 `messages_json` 在 WebUI 可交给 worker 解析，减少主线程卡顿。 |

## 改造注意事项

| 改动 | 必查 |
|---|---|
| 修改 history schema | 迁移兼容、测试、Gateway proto、WebUI type。 |
| 修改 compaction 格式 | `summary_json` 读写、checkpoint UI、resume context、历史旧数据兼容。 |
| 修改 truncate/edit resend | active segment、FTS 清理、subagent parent tool call 保留。 |
| 修改 share | public API、read-only transcript、redaction、sidebar share flag。 |
