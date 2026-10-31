# canvas-ops-whiteboard-storage

- Scene v1 扩展：节点 skewX/skewY 可选，groups:{id,parent?,x?,y?,rotation?,scaleX?,scaleY?,skewX?,skewY?}[] 可选。叶节点和组变换均为画板坐标，渲染层经原生 API 重设父级。兼容缺少组记录的旧数据；组 ID 唯一且不得与节点冲突，祖先必须存在、无环且最多 64 层；可选组缩放非零（绝对值至少 1e-8），数值均有限且受限。

- 元数据：域 canvas，子类 ops，名称 whiteboard-storage，入口 index.ts。
- 注入 ipc/store/mcp/window；不提供 Cordis 服务，不消费配置。
- 独立存储：Store v1 文档位于 `<userData>/data/leafer-boards/`；index.json 保存 ID/标题，ID 的 UTF8 十六进制文件名保存独立场景，避免 Windows 大小写冲突。摘要索引独立限制为最多 10,000 个画板，标题须非空且最多 200 个字符；恢复和更新使用同一 schema。旧版迁移会先验证完整摘要列表，再写入任何场景。无索引时从 leafer-board-scenes.json 逐个写入场景，全部成功后才发布索引，旧文件保留。已有索引（含空）不重复迁移，不复活已删除画板；旧 Excalidraw whiteboard-scenes.json 不混读、不修改。
- 操作串行，八条场景缓存减少读盘，相同规范化 JSON 跳过写入；几何编辑只写当前画板，增删/标题变化才写索引。保留 Store fsync/原子重命名/备份/校验。删除仅移出索引，独立文件保留供恢复，不自动导入。
- IPC whiteboard.summaries() 单次返回 {id,title}[]，既有 list/get/set/remove 兼容。
- MCP whiteboard_panel 命令可传 deferSave:true 使用界面一致的防抖，默认仍回执前 flush；显式 flush 确认落盘。打开时先加载再显示面板，避免重复初始化导航。
- 应用关闭广播 whiteboard:flush，渲染层落盘后通过 complete 回执；失败或 15 秒超时保持窗口打开，不新建窗口。
- `scene.ts` 是权威场景校验：format=desksuite-leafer、version=1、标题、节点、视图、背景、吸附、标尺、参考线、书签；10,000 节点、单画板 4 MiB JSON 字符限制。禁止重复节点 ID、非有限坐标、不支持的节点类型和临时资源 URL。恢复时也验证场景内容。
- IPC whiteboard：list/get/set/remove/complete；四个同名 MCP 工具 whiteboard_list/get/set/remove，set/remove 为变更工具，参数 id/sceneJson。名称保存在场景 title。
- MCP whiteboard_panel：action=open/replace/flush/inspect/command，另有 boardId/sceneJson/command/args。command 分发渲染插件公开命令；new(title?)、removeBoard 由面板处理。inspect 返回当前场景、选择、保存状态等。视图命令须先 open。
- 广播 whiteboard:action，附 requestId；通过 whiteboard.complete 回执；15 秒超时，卸载结束等待。
- 图片视频保存统一资源永久 URI/resourceKind；不嵌入原文件，不新增监听点或窗口，不修改宿主，不使用浏览器存储保存业务数据。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
