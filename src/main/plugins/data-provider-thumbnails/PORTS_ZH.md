# data-provider-thumbnails

- 域 / 子类 / 名称：`data` / `provider` / `thumbnails`
- 入口：`index.ts`
- 注入依赖：Cordis `ipc`、`settings`；Electron `app`、`nativeImage`；内部 `paths.identity` / `paths.normalize` 工具。
- IPC 服务：`thumbnails`
  - `get(path, edge?)` 返回 `{ dataUrl }`，内容是最长边不超过 240px 的 base64 JPEG，保持源图宽高比（等比缩放，不拉伸不裁剪）。
  - `getMany(paths, edge?)` 一次最多接收 64 个不同路径，返回 `{ path, dataUrl }[]`；单个文件失败时对应 `dataUrl` 为 `null`。批量任务仍共用最多 4 个生成并发及现有缓存合并逻辑。
  - `edge` 控制源缩略图请求尺寸，范围为 64–1024，默认 320。
- IPC 服务：`fileIcons`
  - `get(path)` 返回 `{ dataUrl }`，内容是操作系统文件图标（无损 PNG，保留透明通道），用于卡片在没有缩略图时的回退显示；目录路径同样可用。
  - 主进程按扩展名做内存缓存（普通文件图标在同一扩展名内复用，`.exe` / `.lnk` / `.ico` / `.msi` / `.url` 等逐个文件缓存），上限 512 项；并发请求按同一缓存键合并。
- 缓存：JPEG 质量 80，目录为 `<userData>/thumbs`。SHA-1 键由规范化路径身份、文件大小、mtime 与 edge 组成，存于固定槽位文件头部。固定 20,000 个槽位使 LRU 可通过截断和复用文件完成，不需要该插件删除任意文件。
- 缓存限制：按 LRU 使用 `thumbnails.cacheMiB` 设置（32–2048 MiB，默认 512）与 20,000 个非空缓存项；命中时刷新访问时间；重启后从缓存文件头重建索引。
- 生成顺序：先调用 `nativeImage.createThumbnailFromPath`；失败时调用 `nativeImage.createFromPath` 并缩放；再失败时使用 `app.getFileIcon`。
- 系统图标：`fileIcons.get` 使用 `app.getFileIcon(path, { size: 'large' })`；缓存仅存在于内存，不写入缩略图磁盘缓存。
- 事件 / MCP：无。
- 消费配置：`thumbnails.cacheMiB`；设置变更后立即调整预算并剪枝。
- 已知边界：系统预览较小或不可用时可能放大原图/系统图标；对外始终按宽高比等比缩放，最长边不超过 240px。缓存格式版本为 `DSSTHM02`，格式变更时旧缓存整体失效。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
