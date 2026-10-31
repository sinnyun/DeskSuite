# PORTS — system-basic-runtime-log

主进程运行时日志环形缓冲、IPC/MCP/广播链路事件与运行环境信息。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `system` |
| 子类 | `basic` |
| 名称 | `runtime-log` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `mcp`
- `config`

## 提供的 IPC 服务

服务名：`runtime`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `history` | — | `LogEntry[]`，最新的在前（最多 3000 条） |
| `clear` | — | `true` |
| `info` | — | `{ appName, appVersion, electron, chrome, node, platform, arch, mcpPort, mcpTools, services }` |

`mcpTools` 为工具信息数组 `{ name, mutating, impact: 'low'|'high' }[]`（按名称排序），供控制中心渲染
「只读 / 写（低）/ 写（高）」徽标；不带权限档位字段，当前档位另经 `mcp.getAccess` 读取。

`LogEntry` 还支持 `category`、`traceId`、`phase`、`durationMs`、`status`。载荷保留对象结构，同时遮蔽凭据字段、文本内凭据赋值、Bearer token 和本机绝对路径。字符串最多 12,000 字符、数组每层最多 100 项、对象每层最多 200 个字段、嵌套最多 8 层、序列化后的载荷每条最多 48 KB。主进程环形缓冲保留最多 3000 条，仅驻留内存，不写入磁盘。

## 提供的 MCP 工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `get_runtime_logs` | `limit?: number`（1-500，默认 50） | 文本（JSON） |
| `clear_runtime_logs` | — | 文本 |

## 消费的事件

| 事件 | 负载 |
| --- | --- |
| `mcp/tool-call` | `{ name, phase: start\|end, traceId, args?, result?, ms?, error? }` |
| `ipc/invoke` | `{ requestId, service, method, phase, args?, result?, durationMs?, error? }` |
| `ipc/broadcast` | `{ channel, payload }` |

## 广播事件

| 通道 | 负载 |
| --- | --- |
| `runtime:log` | `LogEntry` |

## 消费的配置项

- `mcp.port`

### 后台失败诊断
- 新增注入 `jobs`、`audit`。
- MCP `get_job_status({ jobId? })`：查询后台任务的 state/error/summary，省略 ID 列出任务；最多保留 50 个已结束任务，未知 ID 返回错误对象。
- MCP `get_audit_logs({ limit?: 1..500 })`：读取持久化审计记录，重启后仍可查看后台失败原因。

## 序列化边界

每条完整日志在写入 history 或通过 `runtime:log` 发送前，都会投影成可 JSON 序列化的普通值。undefined、函数、symbol、BigInt、循环引用、抛错 getter 和原型键均会在 Electron IPC 前归一化。
