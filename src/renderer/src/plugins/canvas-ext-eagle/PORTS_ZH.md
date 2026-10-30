# canvas-ext-eagle

- 元数据：canvas / ext / eagle，入口 index.tsx；可停用渲染插件，可选消费 canvas 服务与 eagleLinks IPC。无跨插件文件导入、宿主改动、浏览器持久化、媒体复制或独立 MCP。
- 注册画板通用扩展点：eagle 属性组件、资源信息增强器、外部链接解析器；停用完整回收。canvas 缺失不注册，主进程能力缺失时 Eagle 操作明确报错。
- 从 Eagle 拖入的本地文件继续走 dropImport → import → 统一 resources 链路；增强器调用 eagleLinks.inspect 确认原图并由主进程持久化来源快照，初始化对象名称（300 字符）和标签（最多 50×100 字符）。场景仅保存统一 URI 及普通节点字段，不添加 Eagle 专用场景结构或 base64。
- 链接解析仅接受 eagle://item/<字母数字ID>（可带末尾斜杠），拒绝凭据、端口、查询和片段；其他协议留给其他插件。主进程确认原图并返回统一链接，再走普通导入；不下载网络图片。
- 选中图片的属性扩展显示缓存的名称/ID/文件夹/标签/尺寸/大小/评分/备注/来源网址，展开查看原图路径/统一链接/缩略图/API 地址；支持复制（clipboard.writeText）、刷新、在 Eagle 中定位。中文 UI、SDK 原语、外壳提供内部滚动，不导航任意元数据 URL。监听 eagleLinks:changed 更新，卸载清理。
- whiteboard_panel 命令：eagleInspect({id?,reference?,refresh?}) 返回来源或 null；eagleOpen({id?,reference?}) 返回系统派发结果；默认所选对象，没有来源时报错。属性页按钮走同一主进程 IPC。宿主 inspector({tab:'properties'}) 用于 MCP 选择属性页验收。
