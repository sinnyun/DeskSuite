# system-basic-settings

- 域 / 子类 / 名称：`system` / `basic` / `settings`
- 入口：`index.tsx`
- 槽位贡献：`settings.open` 位于 `sidebar.activity.bottom`（左下角统一设置入口）；`settings.panel` 位于 `floating.panels`。
- 使用 `settings.list/get/validate/set` IPC。主进程 provider 负责 schema 校验和持久化；本插件保存前先校验草稿，再依据 JSON Schema 绘制字段并提交完整命名空间值。`validate` 只读，返回规范化值或带字段路径的结构化错误；`set` 写入前会再次校验。
- 使用 `filesystem.pickDirectory` 添加 MCP 可写根目录。
- 外观模式通过宿主主题服务应用；主题偏好沿用现有 UI 偏好存储。
- setup 会引导 `appearance` 命名空间：启动时读取一次 `settings.get('appearance')` 并监听 `settings:changed`，把 `fontSize.pageTitle/panelTitle/title/sectionTitle/body/label/data` 写入 `documentElement` 上的 `--ds-type-*` CSS 变量；插件停用时移除这些内联变量，恢复 CSS 默认字号。
- 设置字段支持嵌套对象 schema：`object` 类型渲染为带标题的分组，子属性各占一个控件，标签取自 `FIELD_TITLES` 的点分键（如 `appearance.fontSize.body`）。`fontSize` 分组的子字段会在标签旁标注 schema 默认值（如「默认 24 px」），便于对照原始层级字号。
- 外观页底部在「保存设置」左侧增加「更新字体」按钮：校验并保存该命名空间后，立即把保存的 `fontSize` 重新套用为 `--ds-type-*` 变量（复用同一 `save()` 路径，仅多一个应用标记），并提示「字号已更新并生效」。
- 设置分为「程序设置」和「插件设置」；每个设置命名空间以卡片呈现，具体字段也使用卡片式样式。插件分组名称来自主进程注册元数据。
- 程序设置还包含运行环境诊断、存储占用清单及 MCP 服务器/工具清单；插件设置包含渲染层插件注册表与启停控制，取代原独立控制中心面板。
- `settings:open` 载荷可携带 `{ page }` 或 `{ namespace }`；指定 namespace 时会在设置列表加载后切换到该命名空间页（并同步其分类）。
- 存储分页通过 `storage.list` 聚合各插件登记的数据位置与磁盘占用，并在更新 React 状态前使用插件本地有界 Zod schema 解码返回值；通过 `storage.open` 在资源管理器中打开位置；支持手动重新统计。
- 运行环境和 MCP 管理页在更新 React 状态前，分别用插件本地 schema 解码 `runtime.info` 与 `mcp.getAccess`；运行时工具/服务列表及字符串字段均设有长度和数量上限。
- 浮面板固定为 640×500 px，内容在面板内滚动。
- 界面文案使用中文。
