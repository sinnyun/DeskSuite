# data-provider-thumbnails

- 域 / 子类 / 名称：`data` / `provider` / `thumbnails`
- 入口：`index.ts`
- 注入依赖：Cordis `ipc`、`settings`；Electron `app`、`nativeImage`；内部 `paths.identity` / `paths.normalize` 工具。
- IPC 服务：`thumbnails`
  - `get(path, edge?)` 返回 `{ dataUrl }`，内容是最长边不超过 240px 的 base64 JPEG，保持源图宽高比（等比缩放，不拉伸不裁剪）。
  - `edge` 控制源缩略图请求尺寸，范围为 64–1024，默认 320。
- 缓存：JPEG 质量 80，目录为 `<userData>/thumbs`。SHA-1 键由规范化路径身份、文件大小、mtime 与 edge 组成，存于固定槽位文件头部。固定 20,000 个槽位使 LRU 可通过截断和复用文件完成，不需要该插件删除任意文件。
- 缓存限制：按 LRU 使用 `thumbnails.cacheMiB` 设置（32–2048 MiB，默认 512）与 20,000 个非空缓存项；命中时刷新访问时间；重启后从缓存文件头重建索引。
- 生成顺序：先调用 `nativeImage.createThumbnailFromPath`；失败时调用 `nativeImage.createFromPath` 并缩放；再失败时使用 `app.getFileIcon`。
- 事件 / MCP：无。
- 消费配置：`thumbnails.cacheMiB`；设置变更后立即调整预算并剪枝。
- 已知边界：系统预览较小或不可用时可能放大原图/系统图标；对外始终按宽高比等比缩放，最长边不超过 240px。缓存格式版本为 `DSSTHM02`，格式变更时旧缓存整体失效。
