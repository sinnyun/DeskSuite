# Leafer 多媒体画板：已确认范围与统一资源链接

确认日期：2026-10-29。功能决定来自用户交互清单，并在本轮消息中确认；优先于调研报告中的初始推荐。机器可读选择见 [leafer-board-selection.json](./leafer-board-selection.json)。

## 已确认选择

- 首批：全部 A 组（基础平移缩放、选择/变换/翻转、复制删除、撤销、聚焦、编组锁定层级、吸附等距、网格、标尺参考线）；图片和视频；普通文字/便签、基础图形箭头、富文本；卡片展开和交互切换、分区、自动排列、搜索、导航图与书签；自动保存、独立资源身份、多画板、静态图导出、文件管理器/MCP 集成；图片裁剪。
- 以后：动图、PDF/Markdown/TXT 阅读（其中这三类文档优先）、PDF 多页展开、音频、网页；Markdown/TXT 编辑、PDF 批注、视频时间标记；阅读位置记忆、全屏；外部文件变化自动刷新/重新定位；含资源的画板打包；性能加速、滤镜/特效/动画。
- 不需要：Word/Excel/PPT 预览；关系连线/曲线及连线文字；自由笔；导入时复制原文件；旧 Excalidraw 场景转换；SVG 编辑导入导出、图表、复杂形状/思维导图工具、多人协作和专业路径编辑。

“不迁移旧画板”只表示不开发转换器，不授权删除历史文件。“不复制”表示首批登记原文件引用；链接读取时检查可用性与版本是资源身份的基础，自动 watcher、重定位和外部修改推送仍属后续。

## 本轮实现范围

统一资源基础已完成；本轮已替换为 LeaferJS，并实现下述首批画板能力。

- 主进程 `data-provider-resources` 提供注入服务 `resources`、IPC、MCP 及自定义读取协议。
- 渲染 `data-provider-resources` 提供 `resources` 服务及 Leafer 图片加载租约。
- 渲染 `data-ops-resource-library` 提供资源登记、链接列表、实际 Leafer 图片画布与原生媒体消费入口，用于交互和 MCP 验收。
- 新画板由 canvas-provider-scene、canvas-ops-editing、canvas-ops-resources、canvas-ops-whiteboard 四个渲染插件和独立存储/剪贴板输入主进程插件组成；所有协作经服务或 IPC。旧画板文件不做格式转换或删除。

## 统一链接契约

```text
永久引用：desksuite-resource://local/<uuid>/content.<extension>
加载地址：desksuite-resource://local/<uuid>/content.<extension>?v=<revision>
```

所有格式共享一套 ID/URI/元数据/原始字节读取契约，**不把文件转换成同一种内容格式**。保留扩展名供 Leafer 和其他消费者识别；未知类型仍可获取原始字节，但需要对应预览器才可直接显示。

永久 URI 可保存进画板，源路径不塞进 URI。加载前解析得到当前 URL、MIME、种类、大小、可用状态与 revision。源文件修改后 URI 保持，运行时 URL 版本改变；旧版本读取返回 409。版本是文件状态失效标记，不是去重用内容哈希。

资源登记表保存在 `<userData>/data/resource-links.json`，沿用原子 Store 与 `.bak`。文件依然留在原位置；源文件移动、删除或失去访问权限时标为不可用。取消登记只撤销链接，不删除原文件。不自动复制视频、文档或图片。

## 与 Leafer Resource 的分工

官方 [Resource](https://www.leaferjs.com/ui/reference/resource/Resource.html) 是运行时资源管理器：`loadImage` 预加载、`setImage` 自定义图片键、get/remove 管理内存，任务机制限制并行加载。永久身份和跨重启恢复由 DeskSuite 插件承担。

本轮用 `Resource.loadImage(current.url)` 加载实际统一链接；同 URL 的并发请求共享 Promise，使用租约计数，元素销毁后释放，最后一个租约才 `Resource.remove(url)`。不调用全局 `Resource.destroy()`，避免影响其他插件。无需把全格式资源都伪装成 Leafer 图片：视频可直接使用相同 URL，PDF/文本将来交给各自阅读器。

运行时传输使用 Electron 自定义协议，不增加网络监听、不修改 app.ts/services/preload 接入代码、不暴露第二个 bridge。支持 GET/HEAD、单段 Range、ETag、流式读取和取消；渲染 CSP 只为图片/媒体/读取开放这一协议，不给脚本/页面执行开放。

### 主进程消费者

```ts
// 放在自己的 Cordis 插件里，只通过服务注入协作。
export default {
  inject: ['resources'],
  async apply(ctx) {
    const resource = await ctx.resources.register(absolutePath)
    const latest = await ctx.resources.resolve(resource.uri)
    // 持久化 resource.uri；向渲染消费者返回 latest.url 与元数据。
  }
}
```

### 渲染消费者

```ts
// 从本插件允许的 workbench/sdk 入口获取服务，不 import 资源插件文件。
const resources = getService<ResourceClient>('resources')
if (!resources) return // 可选服务缺失时降级
const current = await resources.resolve(savedUri)
if (!current.available) return // 展示原文件不可用
// Image / Video / PDF 阅读器使用 current.url。
// Leafer 图片推荐 resources.acquireImage(savedUri)，节点销毁后 releaseImage(leaseId)。
```

完整接口见主进程与渲染层插件各自 PORTS 文档。

## 后续画板实施顺序

1. 资源基础完成实机验收，固定 link/metadata/stream/cache 契约。
2. Leafer 画板基础：A 组、文字/基础图形、首批图片和视频、卡片交互、独立场景格式与多画板保存。
3. 整理与编辑：富文本、裁剪、分区/自动排列、搜索、导航/书签、标尺参考线、静态导出和文件管理器拖入；逐阶段补 MCP 实机验收。
4. 后续文档阶段按 PDF → Markdown/TXT 优先；Office 不纳入。其他“以后”功能另按实际需要排期。

此前关于先做文档阅读、复制资源及迁移旧场景的推荐已被本次选择覆盖。


## Leafer 替换落地（2026-10-29）

- 引擎与依赖：LeaferJS 2.3.2 + 官方 editor/export 2.3.2；已移除 Excalidraw 运行时依赖。没有引入 Vue 参考项目的宿主或其 blob/自动保存实现。轻量网格、标尺/参考线、小地图、排列、富文本子集、裁剪由独立命令与视图实现，未捆绑尚未实际使用的社区插件。
- 首批基础操作、文字/便签/基础形状、富文本粗斜体/下划线/颜色/列表、图片比例与裁剪、视频播放/进度/音量、折叠/内容模式、逻辑分区/排列/搜索、导航图与书签、多画板/命名/持久化/失败重试/备份、PNG/JPEG、文件浏览器拖入载荷和 MCP 导入均已接入。
- 场景 schema 独立于 Leafer：desksuite-leafer/version 1；保存到 leafer-board-scenes.json，旧 whiteboard-scenes.json 原样保留。图片视频保存统一永久 URI 和 resourceKind；系统剪贴板像素没有原文件，生成私有不可变 PNG 源。
- 图片与文本、视频帧在 Leafer 中绘制；视频控件和文本编辑在内容模式使用 DOM，视频当前帧可静态导出。图片节点先销毁再释放资源租约。
- 后续 PDF/Markdown/TXT 阅读器可各自通过 canvas.registerContent(resourceKind,Component) 注册，不引用画板文件；当前非图片/视频格式保留文件卡片与资源身份，不宣称已经能阅读。
- 已完成 MCP 实机验收与重启恢复，报告 artifacts/verify/leafer-board.json、leafer-restart.json，截图 leafer-board.png，静态导出 leafer-export.png；详见 docs/VERIFY.md。
- 限制：吸附在变换结束时应用；分区是逻辑成员关系；外部无路径 File 拖拽不支持，可使用导入按钮。系统剪贴板/文件对话框/HTML5 拖拽手势未自动模拟；对应资源插入链路和实际渲染已通过 MCP 验证。外部文件 watcher、阅读进度、文档阅读仍为后续阶段。
