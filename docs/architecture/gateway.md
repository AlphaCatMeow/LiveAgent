# Go Gateway 架构

## 职责边界

Gateway 是远程访问中继，不是 Agent 执行环境。它同时面对桌面 Agent 和浏览器 WebUI：

| 方向 | 协议 | 作用 |
|---|---|---|
| Desktop Agent -> Gateway | gRPC `AgentGateway.AgentConnect` 双向流 | 桌面端注册在线 session，接收 WebUI 请求，返回 chat/history/settings/memory/skills 等响应与事件。 |
| WebUI -> Gateway | WebSocket `/ws` | 浏览器端发起 chat、history、settings、skills、memory、cron 等 request，并订阅实时事件。 |
| WebUI -> Gateway | HTTP `/api/*` | 状态检查、文件上传、公网分享页、图片代理、静态资源。 |

## 入口与服务启动

| 文件 | 作用 |
|---|---|
| `cmd/gateway/main.go` | 读取 config，创建 `session.Manager`，启动 gRPC server 与 HTTP server，处理 shutdown。 |
| `cmd/gateway/shutdown.go` | gRPC graceful stop 超时后强制 stop。 |
| `internal/config/config.go` | 地址、token、TLS、静态资源、请求大小、超时等配置。 |
| `internal/auth/grpc_interceptor.go` | gRPC token 校验。 |
| `internal/auth/http_middleware.go` | HTTP API token 校验。 |
| `internal/server/grpc.go` | `AgentGateway` gRPC 服务实现。 |
| `internal/server/http.go` | HTTP mux、WebSocket、API、静态 WebUI 与 public share route。 |
| `internal/server/websocket.go` | WebUI WebSocket 协议主实现。 |

## HTTP 路由

| 路由 | 认证 | 说明 |
|---|---|---|
| `GET /ws` | token | WebUI 主 WebSocket 协议。 |
| `GET /api/status` | token | Gateway 当前 Agent 在线状态。 |
| `POST /api/files/import` | token | WebUI 上传可读文件，Gateway 转发给桌面端导入 workspace uploads。 |
| `GET /api/public/history-shares/{token}` | public token | 公开只读历史分享数据。 |
| `GET /image-proxy` | 视配置/实现而定 | 图片代理，带 URL 安全校验。 |
| `/` | 无或按静态资源策略 | 嵌入/构建后的 WebUI 静态资源与 SPA fallback。 |

## gRPC 服务

| RPC | 类型 | 用途 |
|---|---|---|
| `Authenticate(AuthRequest) -> AuthResponse` | unary | 桌面端认证探活，返回 session 信息。 |
| `AgentConnect(stream AgentEnvelope) -> stream GatewayEnvelope` | bidirectional stream | 桌面端常驻连接，WebUI request 下发为 `GatewayEnvelope`，桌面端 response/event 回传为 `AgentEnvelope`。 |

`proto/v1/gateway.proto` 是 Desktop 与 Gateway 的权威协议定义；Go 侧生成文件位于 `internal/proto/v1/*`。

## Session Manager

`internal/session/manager.go` 是 Gateway 的状态核心。

| 状态 | 说明 |
|---|---|
| `AgentSession` | 当前桌面 Agent 的 session、session id、连接时间、last ping、下发通道和 per-request stream。 |
| history subscribers | 订阅桌面端发来的 history sync event，并广播给 WebUI。 |
| settings subscribers | 订阅 settings sync event，并广播给 WebUI。 |
| chat subscribers | 会话活动广播。 |
| chat runs | 按 requestId/conversationId/clientRequestId 维护实时 chat run buffer。 |
| chat seq | 每个 chat event 分配递增 seq，用于 WebUI attach/resume 后补齐。 |

## Chat Run 缓冲与恢复

| 机制 | 当前含义 |
|---|---|
| `maxBufferedChatRunEvents` | 单个 chat run 最多缓存 50000 个事件，避免无界内存增长。 |
| `chatRunDoneRetention` | 已完成 run 保留 1 小时，用于刷新/断线后恢复最终事件。 |
| `chatRunStaleRetention` | 未完成但长时间无更新的 run 保留 12 小时后清理。 |
| `chatRunByConversation` | conversationId 到 requestId 的索引，用于 attach 当前运行会话。 |
| `chatRunByClientRequest` | clientRequestId 去重，避免 WebUI 重复 chat.start 创建重复运行。 |
| `Seq` | WebUI 可用 `afterSeq` 补收漏掉的事件。 |

## WebSocket 协议角色

| 类型 | 说明 |
|---|---|
| request/response | WebUI 发带 id 的 request，Gateway 返回同 id response 或 error。 |
| broadcast | Gateway 主动推送 `status`、`history.event`、`settings.event`、`conversation.event` 等。 |
| chat stream | `chat.start` 创建 run，`chat.attach`/`chat.resume` 接入已有 run，`chat.cancel` 取消运行。 |

## 安全模型

| 领域 | 设计 |
|---|---|
| 认证 | HTTP API 与 WebSocket 通过 token；gRPC 通过 interceptor 校验 token。 |
| Provider API key | 普通 settings sync 不应携带真实 key；WebUI 只接收 presence/redacted 字段。 |
| 文件访问 | WebUI 上传只把 bytes 交给桌面端导入，Gateway 不直接落地为任意本地路径。 |
| 工具执行 | Gateway 不运行 Shell、FS、MCP、Memory mutation 等高权限工具，只转发请求到桌面端。 |
| Public share | 分享数据走 token 定位，支持只读 transcript，并可按设置 redaction tool content。 |

## Gateway 失败模式

| 失败 | 表现 | 设计处理 |
|---|---|---|
| Desktop offline | WebUI 请求返回 agent offline 或状态 offline | `session.Manager` 检测当前 session，WebUI 展示离线/不可用状态。 |
| WebSocket 断开 | WebUI 自动重连，chat run 可 attach/resume | `GatewayWebSocketClient` 与 SharedWorker 管理重连，Gateway 缓冲 seq event。 |
| gRPC stream 断开 | Agent session close，pending stream 结束 | 桌面端 remote auto reconnect 可重新建立 session。 |
| Chat run 重复提交 | 同一 clientRequestId 重复 | `chatRunByClientRequest` 去重。 |
| 服务退出 | Ctrl+C 后 HTTP/gRPC shutdown | `cmd/gateway/main.go` 和 `shutdown.go` 控制 graceful/force stop。 |
