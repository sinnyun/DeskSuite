# canvas-ops-whiteboard

- Snapshot.textEditing 跟踪临时原生文字编辑状态，打开到提交期间保存提示显示“编辑中”。

- 增量同步：依据不可变节点/数组引用跳过无关通知；视图/选择/保存状态通知不序列化、不全量扫描节点。几何/样式/元数据原位更新兼容实例，包含文字、图形、文件卡、视频和分区；类型/折叠、图片来源或纯文本/HTML 表示切换才可能重建。renderState.sync 提供计数，nodeInstances 提供 id/instance/tag/parent/text，groups 提供原生容器身份、层级及开组/旋转/缩放状态。
- 纯文本和便签采用单个原生 Text 与官方 TextEditor 2.3.2。textEdit({id?,action:open/set/close/inspect,text?}) 走真实内部编辑器；MCP open/set 需 deferSave:true，默认命令 flush 会提交编辑。关闭只记一次历史；commitEditing 在保存前仅提交 TextEditor，不误关裁剪。组合输入/229 键不触发插件 Enter/Escape 快捷键；文字上限 100000 字符。富文本通过显式 richText 模式保留兼容。
- 原生组合：nativeGroup/nativeUngroup 调用 Editor 编解组；groupEdit({id,open?,select?}) 开关/选择真实 Group；deepSelect({ids}) 打开祖先组并选子元素；activateSelection 进入对应编辑模式。Matrix/dropTo 持久化组及叶节点的画板坐标变换，保留组控制框方向。兼容旧扁平 group ID，新嵌套结构保存到 scene.groups；图层面板递归展示并支持选择/进入组合。

- MCP 命令可传 deferSave:true 走界面一致的保存防抖，默认仍回执前 flush；先加载再显示面板，避免自动打开副作用排入第二次过时导航。

- 视口尺寸：Leafer 挂载容器使用内联 absolute/inset 定位，避免库初始化 DOM 时将 CSS 类的 absolute 覆盖为 relative。App 初始化尺寸与 ResizeObserver 均取可见视口，而非依赖内部 canvas 内容的 mount；重复相同尺寸不 resize。renderState.viewport/rendererSize 暴露尺寸约束，高 DPI 像素比保留；小地图尺寸状态相等时不重复触发 React 更新，聚焦画布使用 preventScroll。
- profileMove({steps?:10..120=60,dx?:number=1,dy?:number=0,effects?:'current'|'opaque'}) 按 rAF 调用真实 Editor.move，结束一次性保存历史；需选择对象且退出内部编辑。返回编辑 CPU、tree 绘制、只读命中检测及 rAF 间隔分位数、坐标偏差、移动期间场景更新数。opaque 对比临时关闭背景模糊，finally 恢复；正式外观不变。此项测量语义移动/渲染路径，不等同物理鼠标到屏幕延迟；吸附会有意修正路径。不派发 DOM 输入事件。

- 图片同步：同一资源 URI 且保持展开时，复用 ClipImage、子图层与解码租约。移动/缩放/旋转/翻转、名称/标签/样式/锁定、裁剪提交和历史恢复在原对象更新；资源/类型/折叠状态变化或移除时才按需重建/销毁。已裁剪图片的原生变换将实际子图片变换与外框一起保存为一次事务。renderState.imageNodes 提供临时 {id,instance,layer,lease,ready} 供 MCP 验证稳定性，不进入持久化场景。
- 图层缩略图在等待资源后重新检查节点归属、裁剪态和图片就绪状态，并使用 Leafer syncExport 同步生成小预览，避免异步导出等待已销毁画板的下一帧、堵住后续 PNG/JPEG 导出。

- 所选对象属性经 canvas.getInspectors() 挂载可选插件组件，不在白板内部写来源提供方 UI。inspector({tab:'layers'|'properties'}) 通过与界面相同的状态切换属性页签。URI 列表的外部协议作为 links 交给可选 canvas 解析器；视口本身不下载网络内容。
- file:// 拖入支持 Windows UNC 的主机/共享路径；解码后由统一 resources 校验普通文件并规范化映射盘/UNC 别名，视口不读取图片字节。

- 裁剪提交归属：内部编辑及裁剪提交等待期间，鼠标抬起/拖动结束不执行通用变换保存。END 回调同步捕获外框和子图片几何，编辑器卸载后合并为一次事务；画板或节点实例已切换则丢弃延迟提交。原图像素和插件裁剪算法保持原样。

- 元数据：canvas / ops / whiteboard，入口 index.tsx，版本 2.0.0。贡献 sidebar.activity、floating.panels；面板 whiteboard，初始 1120×760、最小 820×560、内部滚动、中文 UI；原语来自 ui 服务。
- 可选消费 canvas/resources 服务；canvas 缺失隐藏，编辑/导入能力缺失提示不可用。无跨插件文件导入，无宿主修改、浏览器业务存储。
- LeaferJS 2.3.2、官方 editor/export/viewport/view/arrow 2.3.2、leafer-x-ruler 2.0.1、leafer-x-clip-resize-inner-editor 1.10.0、leafer-x-easy-snap 1.11.0。engine.ts 管理真实引擎、选择/变换、插件吸附与刻度、等比例角点缩放、图片租约、视频帧、视口插件命令和场景视图同步、导出；箭头节点使用官方 `@leafer-in/arrow`，普通线节点仍用 Leafer Path；`leafer-x-ruler` 绘制刻度和选中对象标记，React 只保留拖动热区及预览/持久化参考线覆盖层。持久化标尺参考线作为不可见的 Leafer 场景吸附目标，关闭引擎时停用并销毁插件实例。场景不是 Leafer 临时 JSON。销毁节点后再释放图片租约，不清空全局 Resource。
- Leafer design 视口提供滚轮/触摸板平移、Ctrl/Meta+滚轮缩放、空格/中键拖动及缩放边界；官方 view 插件提供 fit/zoom。以引擎 zoomLayer 为视口状态来源，将位置/缩放变更保存到 scene.view，使 React 覆盖层、小地图、拖入坐标、书签和重启恢复共用一份视图。React 层保留框选/多选、C/V/D/A/Z/Y、Shift-Z、Delete、Escape 快捷键、点阵/网格、标尺参考线、小地图、文件拖入和系统图片粘贴。
- 拖入契约：application/x-desksuite-files 的 JSON 绝对路径数组优先，其次原生 File 列表，再次 text/uri-list（本地 file:// 或已有 desksuite-resource:// 统一链接；支持注释、编码的中文/空格/#/%）。Windows 文件管理器拖入的 File 通过统一资源服务登记原文件；无磁盘来源的内存 File、网络 URL、目录及无效链接拒绝，不做 base64 回退。拖入高亮提示；按实时视口和画布 DOM 边界换算落点，同批次去重、32 单位错开、保持原比例，整批一次撤销。MCP whiteboard_panel command=dropImport 接受 paths/payload/uriList 和 clientX/clientY，与真实 drop 共用解析和导入链路；原生 files 只在 UI 内传递，不经 JSON MCP。拖入时先完成进行中的裁剪。
- 文本/便签支持粗体、斜体、下划线、颜色、有序/无序列表；显示前清理 HTML，搜索使用纯文本；静态渲染/导出由 Leafer 文本片段布局完成。已评估官方 `@leafer-in/html`，未安装：HTMLText 按未约束的自然内容测量并作为图片绘制，设置固定节点宽度会缩放整张图片，破坏现有换行。输入/失焦经 canvas.edit 保存。图片节点为 ClipImage，裁剪完全使用该库内置编辑器：双击或裁剪按钮进入，裁剪框可移动、缩放、旋转、拉伸，退出时合并为一次撤销事务。持久化 clip 使用插件原生的节点局部 Leafer 子图层变换（clipSpace: leafer-local）；旧节点框归一化 clip 和 crop 会在读取时转换，不再写入旧格式。修改不改原图。分区是组织关系，选择带上成员。
- 视频使用统一版本 URL 与原生 HTMLVideoElement；内容模式启用控件，当前帧绘入 Leafer Canvas，使画布模式层级和 PNG/JPEG 导出一致。播放/进度/音量不加入场景历史，不恢复阅读进度。缺失源文件展示占位；编解码取决于 Electron。
- 视图命令：fit(selection?)、zoom(value)、transform(dx/dy/scale/angle，真实 Leafer 编辑器)、select(ids) 设置画板选区、export(format=png/jpeg,download=true，返回 dataURL/尺寸)、renderState（含 cropEditing）、thumbnail(id,size=48，经 Leafer 导出节点级透明 PNG dataURL，供图层面板缩略图)。裁剪命令：cropOpen() 为唯一选中的未锁定图片进入内置裁剪编辑器（再次调用退出），cropClose() 退出，cropState(id?) 返回 editing/id/box/layer/clip（节点局部 Leafer 单位），cropResize(width,height,lockRatio?)、cropRatio(ratio='16:9')、cropReset() 仅在裁剪中可用并返回新状态（cropReset 调用库的 reset 还原进入时裁剪区域）。裁剪中仅响应 Escape。内部 videoFrame(id,video DOM 对象) 只绘制不存储；media(id?,action=inspect/play/pause/seek/volume,time?,value?) 返回实际播放器状态。命令随视图挂载/卸载注册回收。
- 静态导出等待图片加载，2 倍分辨率并限制最大面积/边长；包含富文本和视频当前帧，排除控件、网格、标尺、小地图。后续 DOM 阅读器需自己提供画布表示。
- 消费 whiteboard:action，调用 whiteboard.complete 回执；new/removeBoard 在面板处理，其余分发 canvas。验收使用 whiteboard_panel MCP，不操作 DOM 事件。
- 旧 Excalidraw 数据独立保留、不转换。PDF/Markdown/TXT 当前为文件卡片，阅读器按已选“以后”阶段接入 canvas.registerContent(kind,Component)。资源仅载入/重新打开时检查版本，不自动监听。
