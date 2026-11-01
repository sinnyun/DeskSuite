# data-ops-annotations（渲染层）

- 域 / 子类 / 名称：`data` / `ops` / `annotations`
- 入口：`index.tsx`
- 宿主能力：只通过 `workbench/sdk`。
- 可选渲染层依赖：`data-ops-explorer` 提供的 `selection`；服务缺失时仍可打开页面并显示未选择状态。
- 可选渲染层依赖：`data-ops-explorer` 提供的 `panes`；点击标签行会调用 `showTagAggregate`，使中间文件区聚合显示该标签（含子孙标签）的全部文件；再次点击取消。服务缺失时降级提示，不会崩溃。
- 主进程依赖：IPC 服务 `annotations`、事件 `annotations:changed`。
- 槽位贡献：`sidebar.left.tabs` 与 `sidebar.left.content`，两者贡献 id 均为 `annotations`。
- 渲染服务：`annotations`；提供缓存快照、订阅、兼容方法 `get`、`toggleFavorite`、`setRating`、`addTag`、`removeTag`、`allTags`、`exportFor`，以及 `prime`、`forPaths`、`tree`、`setNote`、`importLegacy`。
- 元数据由标注插件自己的 Zustand vanilla store 持有。`subscribePath(path, listener)` 只在该路径元数据引用变化时通知；`getSnapshot()` 保留全路径兼容快照。批量写回时 `favorite`/`rating`/`tags` 未变化的路径保留原冻结对象，未变更行不会再次通知。
- 事件刷新按路径收敛：携带 `paths` 的 `metadata` 广播只重拉缓存中命中的路径；`tree` 广播与不带 `paths` 的 `metadata` 广播（旧数据导入）仍全量重拉并重建标签树。
- 广播按 50 ms 窗口合并，窗口由一次突发中的首个事件开启：窗口内 `metadata` 的路径累积成一次重拉批次；只要出现过 `tree` 或无 `paths` 的事件，该次刷新升级为全量重拉并重建标签树。因此一轮连续写入最多只产生一次 `forPaths` 往返和一次标签树拉取，两次刷新至少间隔 50 ms；服务卸载时清空未触发的窗口。窗口被隐藏或遮挡时，Chromium 会把该定时器钳到约 1 秒，广播到达行级刷新会有同样量级的延迟。
- 重拉走单条串行队列：`get`/`prime`/事件刷新只把还缺的路径入队，排空队列的任务句柄在队列清空当帧就交还，避免入队路径被过期句柄永久搁置。
- 数据：`forPaths`、`tree`、`counts`、标签创建和旧数据导入结果在进入缓存或页面状态前经渲染插件本地 Zod schema 解码；`annotations:changed` payload 校验后才触发刷新；写入仍先乐观更新再调用 IPC。
- 配置 / localStorage：无。
- 标签页支持中文的标签创建、重命名、合并、删除和批量分配。
