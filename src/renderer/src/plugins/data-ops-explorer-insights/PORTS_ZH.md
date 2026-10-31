# PORTS — data-ops-explorer-insights（渲染层插件）

提供目录统计与可持久化的文件暂存篮。本插件提供 `basket` 服务，并消费 `data-ops-explorer`
发布的 `selection` 服务。

## 元数据

| 字段 | 值 |
| --- | --- |
| 类型 | 渲染层插件 |
| 域 | `data` |
| 子类 | `ops` |
| 名称 | `explorer-insights` |
| 入口 | `index.tsx` |

## 槽位贡献

| 槽位 | 贡献 id | 内容 |
| --- | --- | --- |
| `sidebar.activity` | `insights.activity` | 「统计」与「暂存」两个活动栏按钮 |
| `floating.panels` | `analytics.panel` | 类型分布、总量与最大文件面板（id `analytics`） |
| `floating.panels` | `basket.panel` | 三栏布局：文件类型导航、可选文件卡片网格、文件详情与复制/清空/定位/移除操作（id `basket`） |

外壳通过 `openFloatingPanel('analytics')` / `('basket')` 以及 `Alt+1` / `Alt+2` 快捷键打开。

## 服务

提供：

- `basket` —— `{ list(), add(items), remove(path), clear(), subscribe() }`，返回 `BasketItem[]`
  （SelectionItem + `addedAt`）。持久化在主进程 `basket` IPC 服务（`<userData>/data/basket.json`，最多 200 项），
  渲染层只是乐观缓存。
- 缓存由插件自有 Zustand vanilla store 持有；收到主进程 `basket:changed` 后重新读取持久化快照。
- 每次读取或写入 `basket` IPC 快照/结果后，先通过插件本地 Zod schema 解码，再进入 Zustand 缓存；畸形条目或超过 200 条的响应会被拒绝。

消费：

- `ui`（必需）—— UI 原语与悬浮面板。
- `selection`（运行时可缺失）—— 来自 `data-ops-explorer` 的 `{ getSnapshot(), subscribe() }`；
  缺失时面板显示空状态。

## 使用的主进程 IPC

| 服务 | 方法 | 用途 |
| --- | --- | --- |
| `clipboard` | `writeText` | 复制暂存篮路径 |
| `filesystem` | `reveal` | 在文件夹中定位暂存条目 |
| `basket` | `list` / `add` / `remove` / `clear` | 暂存篮持久化（主进程插件 `data-ops-basket`） |

## 渲染层存储

无。暂存篮数据由主进程持有。

## 日志

来源 `Insights`（生命周期、剪贴板操作、暂存篮变更）。错误载荷使用共享限长错误文本 helper，遮蔽凭据和本机路径。
