# PORTS — note-ops-markdown（渲染层）

- 域 / 子类 / 名称：`note` / `ops` / `markdown`
- 入口：`index.tsx`
- 编辑能力委托给 `note-provider-editor` 发布的 `noteEditor` 渲染层服务（Milkdown Crepe，所见即所得，Markdown 即真源）。该插件被停用时面板降级为普通 textarea，不会崩溃。
- 槽位贡献：`sidebar.activity` 打开 `notes` 面板；`floating.panels` 提供跟随应用主题的三栏笔记工作区，中央为编辑器，左右为可折叠的笔记导航与文档检查器。检查器包含目录、反向链接、标签、属性和版本历史；编辑格式工具使用笔记编辑器的浮动选区工具栏。
- 消费必需的 `ui` 服务、可选渲染层 `resources` 服务，以及主进程 IPC：`filesystem`（`listDir`、`listMore`、`readText`）、`fileOps`（`plan`、`approve`、`execute`、`writeText`）、`notePanel`（偏好与文本草稿）、`eagleLinks.link`（Eagle 原件）和 `versions`（Lore 历史列表/创建/恢复）。
- 文档实际内容变化后防抖 700 毫秒，通过计划式文件操作自动写回。笔记目录已由用户明确授权；自动保存仍比较打开时的文件基线，并由文件操作计划再次检查文件指纹。序列化 Markdown 未变化时不创建写入计划、不改文件时间戳。归档干净笔记时仍需确认，再通过已批准的 `mkdir` 和 `move` 计划移入 `.trash/`。
- 编辑器受 `filesystem.readText` 限制：大于 2 MiB 或 20 万字符的文本不可编辑；截断文件拒绝打开，避免覆盖未读内容。
- 递归读取所选笔记目录内的 Markdown 文件，最多 6 层、5,000 个文件；默认跳过 `.trash`、`assets` 和点开头目录，用户可启用回收区浏览。支持标题/路径筛选、正文全文搜索、名称/修改时间排序、目录筛选、最近打开和在指定子目录新建。反链扫描最多读取 500 篇、每篇不超过 128 KiB，并忽略行内及围栏代码。
- YAML frontmatter 在交给编辑器前剥离、保存时回填。属性面板用 YAML 文档模型修改标题、标签、分类、状态和日期，保留未知字段及注释；YAML 格式错误时拒绝应用并显示错误。标签聚合只读取不超过 128 KiB 且前 1,000 篇符合条件的笔记，显示范围提示，并且只按 frontmatter 标签筛选。
- `[[标题]]` 支持补全、跳转、反链及未创建目标提示；同名目标按相对路径区分，跳转支持标题锚点。
- 编辑器按 `路径#载入序号` 作为 key 重挂载，因为内核只在挂载时读取一次初始 Markdown；载入、新建、归档都会触发重挂载。
- 编辑器句柄（读取/替换 Markdown）通过 `noteEditor` 的 `onReady` 回调取得，MCP 的 `setbody`、`inspect` 依赖它；服务缺失时降级 textarea 同样提供句柄。`replaceMarkdown` 会顺手把新的序列化结果经 `onChange` 回报一次，因为内核防抖式的 `markdownUpdated` 在整篇替换这条路径上并不可靠。
- 笔记目录与打开项通过主进程 `notePanel` 服务（`loadPreferences` / `rememberPreferences`，存储键 `note-panel-preferences`）记住，启动时（含渲染进程重载后）自动恢复；目录已不存在时在面板内提示原因，绝不自动弹系统目录选择框。
- 新建笔记使用侧栏内联输入；支持空白、会议、项目和每日模板。每日笔记按日期复用已有文件。初始 Markdown 和后续编辑都自动保存；文本另经 `notePanel` 原子暂存以便崩溃恢复。
- 图片粘贴/拖入只调用 `resources.registerFile` 登记磁盘原件并保存永久 URI。资源选择器插入图片或附件链接，不复制文件；旧相对图片在根目录内注册和 resolve 后仅用于显示，不重写 Markdown。资源服务缺失时明确报错，不回退到 data URL。
- 可输入 `eagle://item/<ID>`，经既有 `eagleLinks` IPC 解析并插入永久资源 URI；不复制或下载源字节。其他外部 scheme 明确报错。
- 新笔记自动写入使用 `writeText(..., { noOverwrite: true })`；已打开文件自动保存前比较磁盘文本与打开基线，检测到外部改动时提供重载或明确覆盖，计划执行仍受文件指纹检查保护。筛选、排序、标签页与面板状态不进入笔记文档，也不会触发写盘。
- 面板提供源码/所见即所得切换、文内查找替换、标题大纲与字符/词数/阅读时间，及 Markdown/HTML 导出。导出 HTML 对内容转义，只把永久资源引用作为链接，不嵌入原始资源字节。
- 最近打开的笔记以标签页显示；切换前完成当前笔记自动保存，再次打开时恢复尚未落盘的故障恢复草稿。阅读模式仅将编辑器设为只读，不改变自动保存流程。
- Lore 历史直接消费现有 `versions` IPC：列出版本、在笔记保存后手动创建快照，并在用户确认后恢复指定版本。传给 Lore 的只有 Markdown 笔记文件，其中是文本和永久资源 URI。当前 IPC 只提供版本元数据，不提供正文差异读取，因此面板不显示文本 diff。
- 消费主进程广播 `note:action`（由 `note-ops-panel` 发出）。变更型 `note_panel` 动作包括 `setroot`、`open`、精确路径/唯一标题 `select`、`reload`、`new`、`setbody`、`setattrs`、`sourceMode`、`readingMode`、`findReplace`、`archive`、`restoreTrash`、`createVersion`、`restoreVersion`；处理后经 `notePanel.complete` 回填。只读 `note_query` 支持 `search`、`outline`、`inspect` 和 Lore `versions` 列表。笔记内容变化后自动保存；破坏性文件与 Lore 操作仍保留确认。
- MCP 工具由主进程 `note-ops-panel` 注册；本渲染插件不注册工具或配置项。最近打开路径由主进程 `notePanel` 偏好 Store 持久化，不写浏览器存储。

- 目录选择改用 `notePanel.pickDirectory`，通过系统选择框授权该目录写入；MCP setroot 不新增授权。自动保存提交前读取编辑器最新正文、预先订阅完成事件，成功后只更新当前文件列表元数据，不重扫目录或重新载入编辑器；中文输入法确认不触发创建。
