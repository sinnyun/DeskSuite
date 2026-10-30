# data-ops-annotations（渲染层）

- 域 / 子类 / 名称：`data` / `ops` / `annotations`
- 入口：`index.tsx`
- 宿主能力：只通过 `workbench/sdk`。
- 可选渲染层依赖：`data-ops-explorer` 提供的 `selection`；服务缺失时仍可打开页面并显示未选择状态。
- 可选渲染层依赖：`data-ops-explorer` 提供的 `panes`；点击标签行会调用 `showTagAggregate`，使中间文件区聚合显示该标签（含子孙标签）的全部文件；再次点击取消。服务缺失时降级提示，不会崩溃。
- 主进程依赖：IPC 服务 `annotations`、事件 `annotations:changed`。
- 槽位贡献：`sidebar.left.tabs` 与 `sidebar.left.content`，两者贡献 id 均为 `annotations`。
- 渲染服务：`annotations`；提供缓存快照、订阅、兼容方法 `get`、`toggleFavorite`、`setRating`、`addTag`、`removeTag`、`allTags`、`exportFor`，以及 `prime`、`forPaths`、`tree`、`setNote`、`importLegacy`。
- 数据：通过 `window.bridge.invoke` 读取并缓存元数据；收到 `annotations:changed` 后刷新；写入先乐观更新再调用 IPC。
- 配置 / localStorage：无。
- 标签页支持中文的标签创建、重命名、合并、删除和批量分配。
