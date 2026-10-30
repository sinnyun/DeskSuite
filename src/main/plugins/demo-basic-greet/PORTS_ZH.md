# 契约 — demo-basic-greet

演示插件：展示最小插件形态，非实际产品功能。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `demo` |
| 子类 | `basic` |
| 名称 | `greet` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `config`

## 提供的 IPC 服务

| 服务 | 方法 | 签名 | 说明 |
| --- | --- | --- | --- |
| `greet` | `ping` | `(name: string) => string` | 内存内调用计数，每次应用启动重置 |

## 提供的 MCP 工具

无。

## 广播事件

无。

## 消费的配置项

无（声明 `config` 仅为演示依赖等待）。
