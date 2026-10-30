# 契约 — data-ops-quick-bookmarks

- 元数据：域 data，子类 ops，名称 quick-bookmarks，入口 index.ts。
- 注入 ipc、mcp、store；不提供跨插件服务，不消费配置项。
- IPC `quickBookmarks.act({ action, groupId?, itemId?, name?, paths?, path? })`：list 读取、createGroup 新建、renameGroup 重命名、deleteGroup 删除分组、add 批量收藏文件夹、edit 修改收藏名称和地址、remove 移除收藏。返回所有分组。ID 稳定，默认分组 common / 常用。
- 写入串行原子执行，失败不保存；只接受绝对路径及实际存在的文件夹，同组地址去重（Windows 不区分大小写），不同分组可收藏相同路径。最多 100 组、每组 1000 项、名称 120 字符。
- IPC `quickBookmarks.complete(requestId, { value?, error? })`：应答渲染层操作。
- MCP `quick_bookmarks`：参数同 act；低影响写操作，只改收藏引用，不删除真实文件。
- MCP `quick_bookmarks_explorer({ action: navigate | select | addSelected | open, path?, paths?, groupId?, itemId? })`：通过事件请求操作活动文件窗格，15 秒超时。select 验证目录中的选择项，addSelected 只收藏所选文件夹，open 解析并打开收藏。
- 事件 `quickBookmarks:changed` 通知刷新，`quickBookmarks:explorer` 携带操作请求及 ID。
- 持久化：Store quick-bookmarks 文档，随 userData 隔离。删除所有分组后重启保持空列表。失效地址仍保留，打开时显示错误供用户编辑或移除。


`quick_bookmarks_explorer` 新增 `action: "view"`，须提供 `viewMode: "list" | "grid" | "gallery" | "grouped"`，复用活动窗格视图切换，不写文件。


视图组合：卡片/列表/画廊与每窗格的 `groupingEnabled` 独立并一同持久化。旧 `viewMode: grouped` 恢复为卡片＋分组开启。统一 152px FileCard 属于资源管理器，并由其向分组布局提供三种区块渲染。嵌入列表采用有限高度虚拟滚动及组内全选，画廊每窗格仅一个预览区：左侧 20%（最小 192px）为单列卡片导航，右侧 80% 为当前文件查看区；分组、折叠及递归范围只作用于左栏。MCP `quick_bookmarks_explorer` 的 view 动作接受可选 viewMode、groupingEnabled、groupBy（kind/modifiedMinute/rating/folder）、includeChildren，返回组合状态。grouped 仅为兼容旧客户端的别名。跨插件分组设置仅走渲染服务。
