# canvas-provider-scene

- Snapshot.textEditing:string|null 与 setTextEditing(id|null) 记录临时原生文字编辑状态；编辑器打开时显示“编辑中”，不将未提交输入标为已保存，此字段不进入场景文件。

- Scene v1 新增可选 groups:{id,parent?,x?,y?,rotation?,scaleX?,scaleY?,skewX?,skewY?}[]；组变换和叶节点几何均为画板坐标，由引擎通过原生 API 重设父级。节点 skewX/skewY 可选；无组记录的旧数据使用单位变换容器。校验拒绝循环/缺失祖先、超过 64 层、ID 冲突及组零缩放。
- edit 结构共享未变节点、节点数组及 groups/guides/bookmarks/view；清除空组并保留有效祖先。select(ids,expandGroups=true) 支持层级扩选，原生选择使用 false 以允许组内单选；相同选择不通知。flush 排空保存前调用可选 commitEditing，确保原生文字在导航/关闭前提交。

- 元数据：canvas / provider / scene，入口 index.tsx；核心插件，无槽位界面。
- 提供渲染服务 canvas，通过 SDK getService 获取。消费 whiteboard IPC（含 summaries/complete）及 whiteboard:flush 事件，不消费配置、不注册 MCP、不使用浏览器业务存储。
- getSnapshot/subscribe 提供稳定快照：id、scene、selection、revision、saving、error、boards、canUndo、canRedo、interaction、cropEditing。消费者禁止修改快照；数据契约在各消费插件 contract.ts 内以结构类型声明，主进程 scene.ts 是持久化权威校验。
- open/create/remove/refresh/replace/flush：导航串行，画板 ID 与场景同时切换。自动保存尾随防抖 500ms，持续变更最多等待 2 秒；不可变快照到写入时才序列化，已确认的相同 JSON 跳过 IPC。saving 涵盖等待/写入，错误优先显示；flush 取消计时并串行排空含写入期间的新编辑。切换/关闭/删除等待写入，失败保留供重试。备份恢复由 Store 承担。refresh 通过 whiteboard.summaries 单次获取轻量列表；WeakMap 缓存历史快照大小；相同视图不更新。
- setup 监听 whiteboard:flush，持久化完成后通过 whiteboard.complete 回执，供应用关闭等待。
- edit(fn) 复制、验证并作为一次历史事务提交，history(undo/redo)；历史最多 100 条及约 16 MiB JSON 字符，至少保留最新快照，重启不恢复撤销历史。
- select(ids) 展开逻辑分组和分区成员；setView 保存平移缩放（0.05–8），不加入撤销；setInteraction 切换内容交互；setCropEditing(id|null) 记录正在裁剪的图片（临时状态，会关闭内容交互）；report 上报异常。
- register(name,handler) / command(name,args) 是编辑能力扩展口；重名报错，注册返回清理函数，缺失插件给出能力不可用。
- registerContent(kind,Component) / getContent(kind) 是后续画布阅读器扩展口；组件接收 node、interactive。kind 对应 resourceKind（pdf、markdown、text 等）或节点类型；原文件通过独立 resources 服务读取。无阅读器时显示文件卡片，后续自定义 DOM 阅读器若需静态导出应补充画布表示。
- 无跨插件文件引用，不持有原文件，不清空全局 Leafer 资源缓存。
- 可选来源扩展：registerInspector(id,Component<{node}>) / getInspectors() 注册/回收属性组件并通知订阅者；registerResourceEnricher(id,reference=>Promise<{name?,tags?}|undefined>) / enrichResource(reference) 初始化普通节点字段，不把提供方专用数据写进场景；registerLinkResolver(id,url=>Promise<稳定URI|undefined>) / resolveLink(url) 解析可选外部协议，未知协议报错、不下载。注册重名报错，均返回生命周期清理函数；来源元数据由所属主进程插件按节点统一 URI 持久化。
