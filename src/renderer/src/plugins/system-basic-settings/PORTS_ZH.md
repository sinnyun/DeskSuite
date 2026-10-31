# system-basic-settings

- 域 / 子类 / 名称：`system` / `basic` / `settings`
- 入口：`index.tsx`
- 槽位贡献：`settings.open` 位于 `sidebar.activity.bottom`（左下角统一设置入口）；`settings.panel` 位于 `floating.panels`。
- 使用 `settings.list/get/set` IPC。主进程 provider 负责 schema 校验和持久化；本插件依据 JSON Schema 绘制字段，并提交完整命名空间值。
- 使用 `filesystem.pickDirectory` 添加 MCP 可写根目录。
- 外观模式通过宿主主题服务应用；主题偏好沿用现有 UI 偏好存储。
- 设置分为「程序设置」和「插件设置」；每个设置命名空间以卡片呈现，具体字段也使用卡片式样式。插件分组名称来自主进程注册元数据。
- 程序设置还包含运行环境诊断、存储占用清单及 MCP 服务器/工具清单；插件设置包含渲染层插件注册表与启停控制，取代原独立控制中心面板。
- 存储分页通过 `storage.list` 聚合各插件登记的数据位置与磁盘占用，通过 `storage.open` 在资源管理器中打开位置；支持手动重新统计。
- 浮面板固定为 640×500 px，内容在面板内滚动。
- 界面文案使用中文。
