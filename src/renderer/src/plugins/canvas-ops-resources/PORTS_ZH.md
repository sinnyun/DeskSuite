# canvas-ops-resources

- import 支持 paths、原生 files: File[]、references 统一链接数组和单个 reference；没有指定来源时使用文件选择器，显式空数组不弹对话框。显式输入最多 100 项，同批次按稳定 URI 去重；异步开始前捕获落点和目标画板，切换画板/卸载插件则取消插入。源文件不可用或图片解码失败时整批不落画板，不产生半批节点。File 通过 resources.registerFile 和现有桥的通用参数适配登记本地原文件，仅持久化统一 URI，不读取/复制图片字节或保存 base64。

- 元数据：canvas / ops / resources，入口 index.tsx；可停用插件，无槽位、配置、事件、独立 MCP。SDK 消费 canvas/resources，IPC 消费 canvasInput.clipboardImage；服务缺失时提示能力不可用，停用注销命令。
- import(paths?/files?/references?/reference?/x?/y?) 返回节点 ID；无来源时调用统一资源选择器。路径登记原文件，reference/references 解析已登记资源。图片通过租约获取原始尺寸，按比例限制初始尺寸 480×360、不放大；视频为画布播放器，其他格式为文件卡片。保存永久 URI 与 resourceKind，不保存运行时 URL、字节或临时 blob。
- pasteImage：主进程保存无原文件的系统剪贴板像素，再走统一资源导入；不复制已有源文件。
- 一批导入是单个 edit/撤销事务；不跨插件引用文件。
- import 额外支持 links?:string[]，经 canvas.resolveLink 转为统一引用；登记后逐个运行 canvas.enrichResource，仅合并名称/标签等普通字段。可选来源插件自行负责识别、元数据持久化及属性 UI；解析/增强失败整批不插入。
