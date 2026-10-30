# note-provider-editor

## 元数据

- 域：`note`
- 子类：`provider`
- 名称：`editor`
- 入口：`index.tsx`
- 层级：渲染层（服务插件，无槽位贡献）

## 依赖

- 只从 `workbench/sdk` 导入 `definePlugin`，不消费其他插件。
- 第三方内核：`@milkdown/crepe`（Milkdown Crepe，MIT）与 `@milkdown/kit`（同一 7.23.0 版本，用于 `replaceAll` 等编辑器命令）。Markdown 即真源：文档由 Markdown 解析、编辑后再序列化回 Markdown，磁盘上的笔记文件保持 CommonMark + GFM。
- 启用的 Crepe 能力：`BlockEdit`（拖拽手柄 + 斜杠菜单）、`Toolbar`（选中文字后出现的浮动格式栏）、`CodeMirror`（代码块）、`ListItem`、`Table`、`ImageBlock`、`LinkTooltip`、`Latex`、`Cursor`、`Placeholder`。常驻 `TopBar` 关闭，避免格式控件挤占正文首屏空间；`AI` 保持关闭。

## 提供的服务

| 服务 | 类型 | 说明 |
| --- | --- | --- |
| `noteEditor` | `ComponentType<NoteEditorProps>` | 所见即所得 Markdown 编辑器宿主组件 |

`NoteEditorProps`：

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `value` | `string` | 不含 frontmatter 的 Markdown 正文。仅在挂载时读取一次，切换笔记由调用方更换 `key` 重挂载。 |
| `onChange` | `(markdown: string) => void` | 编辑后回调序列化后的 Markdown。手工编辑走内核防抖约 200ms 的 `markdownUpdated`（且只认派发出去的事务），调用方不能当成同步回调；程序化 `replaceMarkdown` 会立即回报一次。 |
| `readOnly` | `boolean?` | 映射到 `Crepe.setReadonly`，写入任务执行期间使用。 |
| `resolveImageSrc` | `(src: string) => Promise<string \| null>` | 只影响显示的图片地址代理；返回 `null` 表示保留原引用，因此相对 `assets/...` 路径不会被改写进保存内容。 |
| `uploadImage` | `(file: File) => Promise<string>` | 决定粘贴/拖入图片时写回的引用；默认返回 `assets/<文件名>` 且不落盘。 |
| `onWikiLinkQuery` | `(query: string \| null) => void` | 光标位于未完成的 `[[query` 时在按键后回调查询文本；光标不在查询中则回调 `null`。候选笔记由消费方查询并展示。 |
| `onWikiLinkOpen` | `(target: string, label?: string) => void` | 点击完整 `[[target]]` 或 `[[target\|label]]` 时回调目标；消费方负责消歧和打开笔记。 |
| `sourceMode` | `boolean?` | 为 true 时显示可编辑的 Markdown 源码文本框；默认所见即所得。模式开关由父组件管理，以便放在笔记操作栏中。 |
| `onReady` | `(api: NoteEditorApi \| null) => void` | 编辑器 `create()` 完成后交出编辑器 API，卸载时交回 `null`。API 包含 Markdown 读取/替换、双链完成、大纲和统计。`replaceMarkdown` 执行 Crepe 的 `replaceAll` 后自己再经 `onChange` 回报一次新的序列化结果：整篇替换这条路径上防抖的 `markdownUpdated` 并不可靠（实测编辑器已换正文、面板仍是旧正文），而程序化写入正是 MCP 验收要用的入口。 |

就绪后的 `NoteEditorApi` 还提供 `completeWikiLink({ target, label? })`、`getOutline()`、`getStats()`、`findNext(query)`、`replaceCurrent(query, replacement)` 和 `replaceAll(query, replacement)`。完成双链时若光标前有未结束的 `[[query`，会替换该查询；否则在光标处插入。大纲包含标题级别、纯文本标题和从 1 开始的 Markdown 行号。统计规则：字符数按非空白 Unicode 码点计；汉字、平假名、片假名和韩文每个码点各算一个词，其他字母/数字连续段各算一个词；阅读时间按每分钟 400 个 CJK 字符或 80 个其他词估算，至少 1 分钟。查找按区分大小写的纯文本搜索，选中下一个结果并循环；替换当前项要求当前选区与查询相同；全部替换返回替换数，并在所见即所得模式作为单个事务以支持撤销。所见即所得查找不会跨越被行内格式拆分的文本节点；源码模式搜索原始 Markdown 正文。

## 行为

- 组件独占 Crepe 生命周期：挂载时 `create()`，卸载时把 `destroy()` 串在尚未完成的 `create()` 之后，避免 React StrictMode 双挂载留下孤儿编辑器实例。
- 主题：`@milkdown/crepe/theme/frame.css` 只提供 `--crepe-*` 变量，各功能的组件样式在 `@milkdown/crepe/theme/common/*.css`，必须按启用的特性逐个引入；`crepe-dark.css` 在 `.dark .milkdown` 下重声明同一批变量，使编辑器跟随 DeskSuite 全局明暗切换，并为正文采用紧凑、响应式页边距。格式栏仅在有文字选区时浮动显示。
- LaTeX 特性会带进 KaTeX 字体，其中 `KaTeX_Size3` 以 `data:` 字体内联，需要宿主 CSP 允许 `font-src 'self' data:`。
- 已知限制：`resolveImageSrc` 还在解析时，Crepe 已经把原始相对引用写到 `<img>` 上，因此每张笔记内相对图片都会产生一条 `net::ERR_FILE_NOT_FOUND`（按应用包目录解析，而不是笔记目录）。代理返回后图片显示正常；要消除这条噪声，需要在元素插入前就拿到显示地址。
- frontmatter、文件列表、标签、反链、保存与归档刻意不归本插件，由消费方负责。
- 双链保持为普通 Markdown 文本 `[[target]]` / `[[target|label]]`；本插件只回报光标查询与点击目标，不解析笔记路径、不提供候选 UI。路径解析、同名选择、跳转和反链索引由消费方负责。
- 源码模式只编辑 Markdown 正文，frontmatter 仍由消费方负责。切回所见即所得时会用源码替换编辑器文档，并通过 `onChange` 回报更新后的 Markdown。
- 对外暴露的 Crepe 工具栏、斜杠菜单、链接、图片、代码预览和标题文案已配置为中文。编辑器字体包含中文回退字体并提高行距；标题与统计规则如上。
- 图片块使用 Crepe 内置的缩放手柄和说明文字输入框。缩放比例序列化到 Markdown 图片 alt 元数据，说明文字序列化为 Markdown 图片 title；不会改写图片字节或资源 URI。显示尺寸限制为 960×720 CSS 像素。当前锁定的图片块 schema 没有对齐属性或对齐 UI；把对齐信息编码到 alt 会占用图片替代文本，因此未提供对齐控制。

## 槽位

无。

## 事件

无。

## MCP 工具

无。

## 渲染层存储

无。

- 已卸载实例异步创建完成后不再回报 onReady，避免快速切换笔记时把失效句柄交给面板。
- `value` 和初始图片解析器每次挂载只读取一次。父层内容快照与自动保存状态更新不会重建 Crepe；选区和撤销历史由持续存在的编辑器实例维护。切换文档或显式重载才通过父层 `path#revision` key 重挂载，程序化正文变更通过编辑器 API 执行。
