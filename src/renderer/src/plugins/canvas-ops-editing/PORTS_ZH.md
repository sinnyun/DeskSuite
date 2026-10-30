# canvas-ops-editing

- group/ungroup 委托引擎 nativeGroup/nativeUngroup；select({ids,deep:true}) 经 deepSelect 打开祖先组，默认选择扩展关闭的组层级。剪贴板重映射组 ID/父级并偏移组/叶节点画板坐标，删除由场景服务清理空组。纯文本内容交互委托 textEdit；richText 显式提交原生输入、转义纯文本为 HTML 后进入兼容富文本编辑器。

- 元数据：canvas / ops / editing，入口 index.tsx；可停用插件，SDK 消费 canvas，缺失时降级；卸载回收所有命令。无独立 IPC/MCP/广播/配置/槽位。
- 命令经 canvas.command 或 whiteboard_panel(action=command) 调用。
- add(type/name/text/x/y/width/height) 创建矩形、圆形、直线、箭头、文本、便签、分区；资源节点由资源插件创建。
- select(ids)、update(ids?,patch)：名称、文字/HTML、标签、几何、填充、锁定、折叠、所属分区；锁定对象仅允许解锁，提交前验证整个场景，HTML 显示前清理。
- copy/paste/duplicate/delete 是节点内部剪贴板；系统图片粘贴由资源插件提供。undo/redo；rotate(angle) 与 flip(axis) 通过活动 Leafer Editor 执行几何变换，再统一提交一次 canvas.edit；group/ungroup、lock(value)、order(direction=top/bottom)。
- frameSelection 将选择收进新分区，detachFrame 移出；选择分区自动带上成员一起变换。分区是组织关系，不是嵌套仿射场景图。
- arrange(mode=grid/horizontal/vertical,gap=24)、distribute(axis=x/y)；等距分布至少三项。
- settings(title/background/snap/rulers)、guide(id?,axis,value,remove?)、bookmark(name) 或 bookmark(go=id)、search(query)、collapse(value?)、interaction(value)。
- 所有业务改动统一使用 canvas.edit / 自动保存 / 撤销链路。
