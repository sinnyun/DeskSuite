# DeskSuite 多媒体画板：LeaferJS 功能选型

调研日期：2026-10-29。本文保留调研时的推荐与边界说明。用户现已确认选择，实际范围及统一资源插件实现见 [LEAFER_BOARD_SCOPE.md](./LEAFER_BOARD_SCOPE.md) 与 [选择数据](./leafer-board-selection.json)，以确认结果为准；以下推荐不自动覆盖用户决定。

用户已明确：不需要复杂画笔和高级绘图；画布需要容纳图片、可直接播放的视频、可展开阅读的文档。文档第一优先级是 **PDF、Markdown、TXT**；Office 格式作为后续候选。

## 1. 建议的产品方向

建议做“可组织、可标注、可直接阅读的多媒体画布”：Leafer 负责空间、图形与选择变换，视频可以直接使用官方 Video 元素；长文档通过跟随画布坐标的 React 阅读层提供翻页、滚动、选字和搜索。卡片折叠时显示轻量预览，展开后在原位置阅读。

这是一项架构建议，不是 Leafer 自动提供的整套功能。尤其不能把 `@leafer-in/html` 的 HTMLText 当作任意网页、视频、Office 文档的交互容器：其官方实现通过 SVG 中嵌入 HTML 绘制，并继承 Image。它适合富文本显示，不负责完整浏览器交互。[HTMLText 文档](https://www.leaferjs.com/ui/plugin/in/html/)

需要区分四件事：画布内预览、进入卡片交互、文档内容编辑、保存回源文件。首批建议先交付前两项。

## 2. 三个来源分别能带来什么

| 来源 | 能提供的价值 | 不能直接当成现成能力的部分 |
| --- | --- | --- |
| LeaferJS 核心与官方基础插件 | 图形、场景树、坐标变换、选择、缩放平移、文本编辑、导出 | 多画板管理、业务工具栏、资产持久化、全文搜索、文档阅读器 |
| leafer-free-board | EditorCore、快照、历史命令、连线与工具交互的参考实现 | React 界面、可靠桌面存储、持久图片资源、系统文件粘贴、视频/PDF/Office 适配 |
| 官方 PxGrow 增强插件与社区 | 视频、动图、连线、吸附、标尺、富文本、SVG 等 | 页面标记“正式版”不等于已经在 Electron 验证；“开源”不等于所有插件都采用同一许可 |

[LeaferJS 指南](https://www.leaferjs.com/ui/guide/) · [官方插件源码目录](https://github.com/leaferjs/leafer-in/tree/main/packages) · [参考项目 README](https://github.com/ZekoFront/leafer-free-board/blob/main/README.md) · [社区目录](https://www.leafer.pro/#plugin)

## 3. leafer-free-board 的保留与改造范围

本次参考的已读取源码快照为 `cd5c5d0b63144a102e6d15a0b6ebfcfe4af03179`；后续采用时应重新确认上游变化。

| 模块 | 实际能力 | 建议 |
| --- | --- | --- |
| EditorCore / CanvasContext | 实例生命周期、插件 API、场景保存加载 | 借鉴结构，适配 DeskSuite 插件生命周期 |
| HandlerPlugin | 选择/变换事件与连线更新 | 保留基础思路，避免与阅读层输入冲突 |
| HistoryPlugin | 增删、移动、属性、结构变化的撤销重做；最大栈深 50 | 可复用设计；补齐多媒体资源、批量操作与历史事务 |
| CopyPlugin | 插件内存中的元素及内部连线复制 | 不等于操作系统剪贴板中的图片/文件粘贴，需要补充 |
| ConnectionPlugin | 拓扑关系、连线/标签与导入恢复 | 如保留关系线可参考；同时评估官方 Linker，避免双重拓扑 |
| ShapePlugin / 图形工厂 | 基础图形、文本、箭头、曲线、画笔及部分图形库 | 只留下用户选定工具；星形、复杂多边形及画笔可去除 |
| Snap / Ruler / DotMatrix / ScrollBar | 交互辅助 | 按需启用；标尺不等于可拖参考线 |
| EditorCanvas / RenderCanvas | Vue 编辑与只读界面 | React 重建，避免为单个画板引入 Vue/Pinia/Naive UI |
| useCanvasSnapshot | IndexedDB 缓存，失败回退 localStorage；场景与历史分 key | 替换为主进程持久化；其默认 500 元素上限会停止保存/恢复 |
| useCanvasLifecycle | CHANGE 事件后防抖 1 秒保存；卸载时取消防抖 | 不照搬；关闭、切换、退出前需要可等待的保存确认 |
| 图片导入 | Object URL → Image；加载完成释放 URL | 不作为磁盘资产地址；场景保存时必须有可恢复的资产引用 |

源码入口：[EditorCore](https://github.com/ZekoFront/leafer-free-board/blob/cd5c5d0b63144a102e6d15a0b6ebfcfe4af03179/src/core/EditorCore.ts)、[HistoryPlugin](https://github.com/ZekoFront/leafer-free-board/blob/cd5c5d0b63144a102e6d15a0b6ebfcfe4af03179/src/plugins/history/HistoryPlugin.ts)、[CopyPlugin](https://github.com/ZekoFront/leafer-free-board/blob/cd5c5d0b63144a102e6d15a0b6ebfcfe4af03179/src/plugins/edit/CopyPlugin.ts)、[缓存](https://github.com/ZekoFront/leafer-free-board/blob/cd5c5d0b63144a102e6d15a0b6ebfcfe4af03179/src/composables/useCanvasSnapshot.ts)、[生命周期](https://github.com/ZekoFront/leafer-free-board/blob/cd5c5d0b63144a102e6d15a0b6ebfcfe4af03179/src/engine/edit/useCanvasLifecycle.ts)、[图片导入](https://github.com/ZekoFront/leafer-free-board/blob/cd5c5d0b63144a102e6d15a0b6ebfcfe4af03179/src/components/header/HeaderCenter.vue)。图片跨重启失效的判断来自上述源码链路，未在上游应用中实测。

参考项目 `package.json` 为 0.0.1、`private: true`；README 的 npm 使用说明不作为已发布包可直接使用的证据。项目 MIT，复用代码应保留相应许可及版权。[配置](https://github.com/ZekoFront/leafer-free-board/blob/main/package.json)、[许可](https://github.com/ZekoFront/leafer-free-board/blob/main/LICENSE)

## 4. 官方插件清单与适合程度

以下包名来自官方 `leafer-in` 仓库；核心与官方仓库使用 MIT。表中的“首批”是推荐，仍以最终功能选择为准。仅列包名不表示要全部安装；版本需统一并锁定。[源码目录](https://github.com/leaferjs/leafer-in/tree/main/packages)、[许可](https://github.com/leaferjs/leafer-in/blob/main/LICENSE)

| 插件（均为 @leafer-in/ 前缀） | 对本画板的作用 | 建议 |
| --- | --- | --- |
| editor | 选择、框选、移动与变换 | 首批 |
| viewport | 滚轮、触摸板缩放平移 | 首批 |
| view | 适应全部、聚焦元素/区域 | 首批 |
| text-editor | 双击编辑普通文字 | 首批 |
| resize | 尺寸编辑基础，配合 Editor 按需引入 | 首批依赖评估 |
| arrow | 箭头样式 | 保留基础箭头时使用 |
| linker | 连接卡片的连线元素 | 保留关系线时首选评估 |
| video | 视频帧在 Canvas 中播放 | 首批原型验证 |
| find | 按场景元素条件查询 | 内部基础能力，不是文档全文检索 |
| state | 悬停、选中、禁用等状态样式 | 可用 |
| scroll | 整体画布滚动条 | 可选 |
| flow | 流式自动布局 | 卡片整理后续候选 |
| box | 容器相关基础能力 | 按实际元素依赖启用 |
| scroller | Box 内滚动 | 适合 Canvas 内容容器；不能代替 PDF 文本阅读层 |
| export | 场景/元素静态导出 | 后续导出预览图 |
| film | 动图播放 | GIF/APNG 候选 |
| html | 富文本静态绘制 | 普通标签富文本候选，不用作视频/网页宿主 |
| bright / scale-fixed / position | 聚焦突出、固定尺寸辅助、定位 | 按选中反馈和控制点需求评估 |
| filter / image-filter / color | 图像效果与颜色处理 | 图片处理需求确定后再加 |
| corner / stroke-sides | 圆角路径、独立边框 | 外观细化，后续 |
| animate / transition | 动画与渐变过渡 | 仅保留轻量展开过渡，不默认引入 |
| motion-path / motion-text / robot | 路径运动、运动文字、精灵动画 | 当前不推荐 |
| bg-runner | 后台继续运行动画 | 默认不启用；离屏媒体宜暂停 |
| interface | 插件接口定义 | 依赖包，不是可选用户功能 |

官方 Editor 的“历史记录”页面提供记录时机与事件指导，并非自带完整持久化撤销栈；因此仍要保留应用历史模型。[历史记录文档](https://www.leaferjs.com/ui/plugin/in/editor/Editor/history.html)

### 官方增强插件的关键结论

`@leafer-in/video` 当前源码包声明 MIT，版本 2.3.2；API 提供时长、进度、音量、播放、暂停、停止等，播放器控制 UI 仍需我们接入。它的输出是可在场景树中变换的视频元素，并不要求所有视频都覆盖一个 DOM 窗口。视频编码可解码性、拖动 seek、离屏暂停、多视频并发以及 Electron 打包后播放仍须实机验证。[Video 文档](https://www.pxgrow.com/docs/plugin/official/video/)、[包配置](https://github.com/leaferjs/leafer-in/blob/main/packages/video/package.json)、[Video 源码](https://github.com/leaferjs/leafer-in/blob/main/packages/video/src/Video.ts)

`@leafer-in/film` 当前源码也声明 MIT、2.3.2；检索到的旧 Film 文档仍写本地 tgz 购买安装，与现在的仓库和官网“已开源”不一致。选型依据应以拟采用版本的源码及许可证为准，而非旧购买说明。[当前 Film 包](https://github.com/leaferjs/leafer-in/blob/main/packages/film/package.json)、[旧文档](https://www.pxgrow.com/docs/plugin/official/film/)、[当前官网](https://www.pxgrow.com/)

Linker 是连线元素；PxGrow 的 Linker Editor 是另一款可视化编辑套件，不能将二者的开源和授权情况混为一谈。基础连线可以结合 Linker 自行实现创建手势。[Linker 文档](https://www.pxgrow.com/docs/plugin/official/linker/)

## 5. 社区目录调研

2026-10-29 在浏览器实际读取了 leafer.pro 的 16 张插件卡片，并核对了重点插件的详情/源码。目录中既包含社区作者作品，也收录 PxGrow 官方增强插件；应按作者和源码归类，不能都称为第三方插件。

### 5.1 当前目录的全部 16 个条目

| 条目 | 用途 | 许可/状态证据 | 对本项目建议 |
| --- | --- | --- | --- |
| Video | 画布视频 | 官方 @leafer-in/video；源码 MIT；目录标体验版 | 首批验证，见上节 |
| Film | 动图 | 官方 @leafer-in/film；源码 MIT | 后续 |
| Image Filter | 图片滤镜 | 官方开源目录条目 | 低优先级 |
| Linker | 关系线 | 官方 @leafer-in/linker；源码 MIT | 需要连线则评估 |
| Transition | 渐变颜色动画 | 官方开源目录条目 | 暂缓 |
| Stroke Sides | 矩形四边独立样式 | 官方开源目录条目 | 暂缓 |
| Motion Text | 运动路径文字 | 官方开源目录条目；目录标体验版 | 暂缓 |
| leafer-x-easy-snap | 对齐吸附 | 包配置 MIT；1.11.0 | 推荐；参考项目也在用 |
| leafer-x-ruler | 标尺与单位 | 包配置 MIT；2.0.1 | 可选；不与参考线功能混同 |
| leafer-x-richText | 字符级富文本 | 包配置 MIT；1.0.0 | 有局部文字样式需求再加；不是 Markdown/PDF 阅读器 |
| leafer-x-svg | SVG 与 Leafer 对象转换 | 包配置 MIT；0.1.0 | 后续；验证支持的 SVG 子集 |
| leafer-x-fast-viewport | WebGPU 视口加速 | 包配置 MIT；0.7.0；peer 要求 >=2.2.0 <2.3.0 | 当前不直接接入 2.3.x；先证明瓶颈并验证兼容性 |
| leafer-text-pro | 专业富文本排版、特效 | 目录正式版；未给出源码仓库，许可待核实 | 暂缓，不按 MIT 免费插件处理 |
| leafer-x-guide-line | 居中/边缘吸附、距离、辅助线 | 赞助入口；未给出源码，授权条款待核实 | 与 easy-snap 比较后择一，首批优先开源方案 |
| 特效文字插件 | 描边、阴影、渐变文字 | 开源目录条目，本次未单独核对许可文件 | 暂缓 |
| leafer-x-feather | 羽化滤镜 | 开源目录条目，本次未单独核对许可文件 | 暂缓 |

条目来源：[社区插件目录](https://www.leafer.pro/#plugin)。重点源码：[easy-snap](https://github.com/Xdy1579883916/leafer-x-easy-snap)、[ruler](https://github.com/LvHuaiSheng/leafer-x-ruler)、[richText](https://github.com/ZhengNan-coder/leafer-x-richText)、[SVG](https://github.com/zhanglaoye2025/leafer-x-svg)、[fast-viewport 依赖范围](https://github.com/ZhengNan-coder/leafer-x-fast-viewport/blob/main/package.json)。无公开源码的条目：[text-pro](https://www.leafer.pro/plugin/view?vid=zwS9w4Cw)、[guide-line](https://www.leafer.pro/plugin/view?vid=2ACwPSP4)。

### 5.2 早期目录及其他相关候选

| 候选 | 调研结果 | 建议 |
| --- | --- | --- |
| leafer-canvas-player | MIT，npm 0.1.3；视频绘制到 Canvas，自带控制条/封面；全屏需宿主回调实现 | 与官方 Video 二选一验证；优先官方基础 + 自有简洁控制条，也可借鉴其 UI |
| leafer-pdf-plugin | 被官方列为 Legacy；README 使用旧 usePlugin API | 不作为首选阅读器；需适配旧 API，优先 PDF.js |
| leafer-x-dot-matrix / dotwuxian | 点阵背景，前者 npm 元数据 MIT | 选一种，非首批刚需 |
| leafer-x-clip-resize-inner-editor | 容器包裹实现裁剪的社区方案 | 有裁剪需求时与商业 Clipper 比较，采用版本再核许可 |
| leafer-x-echarts | MIT；SVG 图表，动画关闭；README 同时声称支持 tooltip/legend 又把更好交互列为 TODO | 仅作图表原型候选，不承诺完整交互图表 |
| leafer-x-minimap | npm 0.0.3、MIT；登记的仓库 README 读取返回 404 | 可选；功能与维护状态未核实，不列即插即用 |
| leafer-x-tooltip / tooltip-canvas / edit-toolbar | 悬浮提示与编辑工具条 | DeskSuite 已有 React UI，先复用本项目 UI 原语 |
| leafer-connector / leafer-x-connector / polyline-editor | 其他连线与折线编辑选择 | 不同时安装多套连线系统；基础关系图先评估官方 Linker |
| @chenyomi/leafer-htmltext-edit | Quill 富文本编辑，作者声明自定义商业许可 | 需要完整富文本且接受授权后才考虑；不是免费替代品 |
| leafer-x-webfont | 字体按字子集加载，可对接自托管服务 | 非默认；离线桌面优先系统或本地字体 |

来源：[官方早期社区目录](https://www.leaferjs.com/ui/en/contribute/)、[播放器源码说明](https://github.com/rideWind97/leafer-player)、[旧 PDF 插件](https://github.com/reduce4/leafer-pdf-plugin)、[图表插件](https://github.com/sedrew/leafer-x-echarts)、[商业富文本说明](https://www.npmjs.com/package/@chenyomi/leafer-htmltext-edit)、[字体作者演示](https://webfont.shenzilong.cn/leafer-demo/)。npm 元数据仅代表包声明，未验证所有插件的安装/运行。

### 5.3 官方商业套件：适合放在候选池

PxGrow 提供图片裁剪/平铺、路径/渐变/形状/节点/遮罩/运动编辑、可视连线、标尺与布局编辑，以及 Viewport/Image/Vector/Regions Lighter 等性能方案。对本项目最有潜在价值的是 **Clipper、Image Lighter、Viewport Lighter**；但先做资源缩略图、分页、离屏卸载，再判断是否需要采购性能插件。其他专业绘图套件与当前需求关联较低。具体授权、Electron/离线许可和报价未在本次确认，也没有购买或安装。[官方产品清单](https://www.pxgrow.com/)

## 6. 视频与文档如何真正“在画布内展开”

以下均为候选实施设计，不把兼容性推测写成已验收功能。

| 内容 | 折叠状态 | 展开后的直接交互 | 建议技术 | 首批范围与边界 |
| --- | --- | --- | --- | --- |
| 图片 | 缩略图 | 原比例放大、移动、缩放 | Leafer Image | 首批；原图与缩略图分开 |
| 视频 | 封面 + 时长 | 原位播放、暂停、拖进度、调音量 | 官方 Video + 控制条；可选社区播放器 | 首批；格式受实际解码能力限制，不承诺所有扩展名 |
| PDF | 首页面预览 + 页数 | 卡片内滚动/翻页、选择文字、搜索 | PDF.js 阅读层 | 首批；扫描 PDF 没有文字层时无法直接选字/全文搜，OCR 另项 |
| Markdown | 标题/内容摘要 | 正文滚动、选字、链接、代码块/表格 | React Markdown | 首批阅读；编辑/写回另选 |
| TXT/代码 | 文本摘要 | 滚动、换行、选字、查找；代码高亮可选 | React 文本阅读层 | 首批阅读；大文件分段及编码提示 |
| GIF/APNG | 首帧 | 动图播放与暂停 | 官方 Film | 后续；格式支持专项验证 |
| 音频 | 文件名 + 时长 | 播放、进度与音量 | 原生 audio + React 控件 | 后续 |
| DOCX | 文档卡片/首页缓存 | 展开预览 | docx-preview 或本地转换 | 后续；老 .doc 另需转换，不承诺 Word 级保真 |
| XLSX/CSV | 表格摘要 | 工作表切换、网格滚动 | SheetJS/CSV 解析 + 表格 UI | 后续；解析器不是完整 Excel 编辑/计算引擎 |
| PPTX | 幻灯片缩略图 | 翻页查看 | 本地转 PDF/图片 | 后续；转换器依赖待选型，动画另议 |
| 网页 | 链接摘要/截图 | 允许嵌入的站点原位浏览 | 受约束的网页适配器 | 后续；网站可能禁止 iframe，需外部打开降级 |

阅读器依据：[PDF.js](https://mozilla.github.io/pdf.js/)、[React Markdown](https://github.com/remarkjs/react-markdown)、[docxjs](https://github.com/VolodymyrBaydalka/docxjs)、[SheetJS React 集成](https://docs.sheetjs.com/docs/demos/frontend/react/)。网页限制依据：[X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options)。

### 统一的卡片交互约定（建议）

1. 单击选择卡片，拖标题栏移动，边缘控制点改变阅读区域尺寸。
2. 点击“展开/阅读”后，视频或文档就在该卡片的位置展开，不默认跳到外部窗口。
3. 阅读中滚轮作用于卡片内容；空格拖动/退出阅读后重新操纵整个画布。Esc 返回画布选择模式。
4. PDF 页码/滚动、视频时间等按卡片记忆；不把视频每一帧或每次滚动计入撤销历史，也不每帧写盘。
5. 第一版建议同一时刻只有一张文档卡片获得键盘焦点；多张文档可以同时展开。视频并发上限是可配置资源策略，应通过实测确定。
6. DOM 阅读层跟随相机的位置/缩放并裁剪到卡片内；第一版建议阅读卡片禁止任意倾斜，旋转卡片先回到正向阅读，减少文字、输入和合成问题。
7. 离屏文档只保留预览；PDF 按页加载并释放无用页；未播放视频保持封面。性能不能用“静态图形百万级”宣传替代多媒体实测。
8. 导出静态画布时，视频是封面/某一帧，文档是指定页/摘要；保存完整多媒体内容应使用包含资产的画板包。DOM 内容不会自动进入 Leafer export 结果，需要单独生成预览或合成。

## 7. 保存与插件边界（建议）

场景元数据、资源、可重建缓存分开管理：

```text
画板场景：元素、坐标、尺寸、类型、资产 ID、连接关系、阅读状态、格式版本
资产库：原图片、视频、PDF、Markdown、TXT（复制模式）或受管理的外部引用
缓存：图片缩略图、视频封面、PDF 页面预览；可删除并重新生成
```

复制和引用可同时存在：复制模式便携但占空间；引用模式自动反映外部修改但可能失联。场景不能持久保存一次性的 blob URL。视频/PDF 不内嵌为巨大的 Base64 场景字符串。

DeskSuite 业务能力仍放独立主进程 Cordis 插件及渲染层插件；共享资源/预览能力通过服务注入协作，不跨插件 import。桥接继续使用唯一 window.bridge。MCP 按功能提供导入、增删、播放/跳转、文档翻页、保存和读取状态工具，以便按仓库要求验收。若本地大媒体需要新的读取方式，先确定流式/分段能力及权限，再设计服务契约；不在画板插件中自行增加网络监听，也不默认新增第二个 preload 桥。

旧 Excalidraw 数据先保留，迁移另建格式版本和转换器。未能转换的元素不能静默丢弃。首次切换引擎前应提供旧数据备份与转换报告。

## 8. 功能选择表

下表保留初始建议供比较；用户选择列已按 2026-10-29 确认结果更新：首批 27 项、以后 16 项、不需要 13 项。实施边界见 LEAFER_BOARD_SCOPE.md，后续文档优先 PDF、Markdown、TXT。

### A · 画布与基础操作

| 编号 | 功能 | 建议 | 能力来源与边界 | 用户选择 |
| --- | --- | --- | --- | --- |
| A01 | 无限画布平移、滚轮与触摸板缩放 | 首批 | 官方 viewport；参考项目已有接入 | 首批 |
| A02 | 框选、多选、拖动、等比例缩放 | 首批 | 官方 editor；参考项目已有 | 首批 |
| A03 | 旋转与水平/垂直翻转 | 以后 | 官方 editor 与元素变换；阅读卡片可限制旋转 | 首批 |
| A04 | 复制、粘贴、重复、删除 | 首批 | 参考项目有内部元素复制；系统剪贴板图片/文件需要补充 | 首批 |
| A05 | 撤销与重做 | 首批 | 参考 HistoryPlugin；媒体与文档操作需要接入同一历史模型 | 首批 |
| A06 | 适应全部、聚焦选中、恢复 100% | 首批 | 官方 view；导航按钮需要界面实现 | 首批 |
| A07 | 编组、解组、锁定、前后层级 | 首批 | 官方 editor；参考项目有编组命令 | 首批 |
| A08 | 对齐吸附与等距排列 | 首批 | easy-snap 负责吸附；等距排列命令需要补充，不能视为同一现成功能 | 首批 |
| A09 | 点阵/网格背景开关 | 以后 | 参考项目 DotMatrixPlugin；社区 dot-matrix/dotwuxian | 首批 |
| A10 | 标尺与可拖参考线 | 以后 | 社区 ruler 提供标尺；参考线/吸附线是另一能力，按插件分别选择 | 首批 |

### B · 图片、视频与文档

| 编号 | 功能 | 建议 | 能力来源与边界 | 用户选择 |
| --- | --- | --- | --- | --- |
| B01 | 图片导入、粘贴、原比例显示 | 首批 | 官方 Image；参考项目有图片导入，但其临时 URL 存储需要替换 | 首批 |
| B02 | 视频在画布内播放、暂停、进度、音量 | 首批 | 官方 video 或社区 leafer-canvas-player；控制条与本地资源访问需集成 | 首批 |
| B03 | GIF/APNG 等动图播放 | 以后 | 官方 film；具体格式解码支持需按运行环境验证 | 以后 |
| B04 | PDF 在卡片内翻页、滚动、选字与搜索 | 首批 | PDF.js + React 阅读层；不是 Leafer 原生完整能力 | 以后 |
| B05 | Markdown 在卡片内阅读 | 首批 | React Markdown 阅读层；代码块、表格和链接按阅读器配置实现 | 以后 |
| B06 | TXT 与代码文件在卡片内阅读 | 首批 | React 文本阅读层；换行/编码/大文件分页需自行处理 | 以后 |
| B07 | 把 PDF 多页展开成独立画布页面 | 以后 | PDF.js 分页渲染 + 页面布局；区别于 B04 的单卡片阅读 | 以后 |
| B08 | 音频卡片播放 | 以后 | HTML audio 阅读层；本次未发现需优先采用的 Leafer 官方专用插件 | 以后 |
| B09 | Word 文档预览 | 以后 | docx-preview 等或本地转换；不承诺与 Word 像素一致，也不等于编辑 | 不需要 |
| B10 | Excel/CSV 表格预览 | 以后 | 表格解析器 + 阅读网格；CSV 可先做，公式计算与原样式还原另行定义 | 不需要 |
| B11 | PowerPoint 幻灯片预览 | 以后 | 优先本地转 PDF/图片；转换依赖及还原程度待选型 | 不需要 |
| B12 | 网页/在线内容嵌入 | 以后 | 独立网页适配器；部分网站禁止 iframe，需链接卡片降级 | 以后 |

### C · 标注与轻量内容编辑

| 编号 | 功能 | 建议 | 能力来源与边界 | 用户选择 |
| --- | --- | --- | --- | --- |
| C01 | 普通文字与便签 | 首批 | 官方 Text/text-editor；参考项目已有文字工具 | 首批 |
| C02 | 矩形、圆形、直线与箭头 | 首批 | 官方基础元素/arrow；参考项目已有 | 首批 |
| C03 | 卡片之间的关系连线 | 首批 | 官方 linker + 自建创建手势，或参考 ConnectionPlugin；可视化 Linker Editor 需另核授权 | 不需要 |
| C04 | 曲线、折线及连线文字 | 以后 | 参考项目有曲线和连线标签；复杂折线控制另加插件 | 不需要 |
| C05 | 简单自由笔与荧光标注 | 不需要 | 参考项目有画笔；按此前偏好默认建议不纳入首批 | 不需要 |
| C06 | 富文本：局部加粗、颜色、列表 | 以后 | 社区 richText 可评估字符样式；列表/长文编辑建议 React 编辑层 | 首批 |
| C07 | Markdown/TXT 内容编辑并保存 | 以后 | 新编辑器及文件写回契约；与 B05/B06 只读预览分开选择 | 以后 |
| C08 | PDF 页码/坐标绑定批注与高亮 | 以后 | PDF.js 阅读位置 + 自建标注模型；PDF 导出写回另算 | 以后 |
| C09 | 视频时间点标记与截帧 | 以后 | video.currentTime + 帧导出；需记录视频资产版本和时间戳 | 以后 |

### D · 组织与阅读体验

| 编号 | 功能 | 建议 | 能力来源与边界 | 用户选择 |
| --- | --- | --- | --- | --- |
| D01 | 卡片折叠/展开，直接在画布内阅读 | 首批 | 自建卡片状态；展开保留世界坐标锚点，不跳出画布 | 首批 |
| D02 | 进入内容交互 / 返回画布操作 | 首批 | 自建输入焦点与滚轮路由；避免滚文档变成缩放画布 | 首批 |
| D03 | 记住 PDF 页码、滚动位置和视频时间 | 首批 | 按画板/卡片保存阅读状态；播放进度不进入图形撤销栈 | 以后 |
| D04 | 分区框、标题与卡片分组 | 首批 | 官方 Frame/Box/Group + 自建分区语义；与 A07 临时编组不同 | 首批 |
| D05 | 自动排列：网格、横排、竖排 | 以后 | 官方 flow 提供布局基础；整理已有卡片需要应用命令 | 首批 |
| D06 | 搜索卡片名称、标签、文字 | 以后 | 自建内容索引；官方 find 只是场景元素查找，不是全文搜索 | 首批 |
| D07 | 缩略导航图与书签定位 | 以后 | 自建或评估 minimap；已找到 npm 包但其仓库 README 未能读取 | 首批 |
| D08 | 全屏阅读 / 视频播放 | 以后 | 自建聚焦阅读界面；卡片在画布内展开仍为默认入口 | 以后 |

### E · 保存、资源与互通

| 编号 | 功能 | 建议 | 能力来源与边界 | 用户选择 |
| --- | --- | --- | --- | --- |
| E01 | 自动保存、失败重试、备份与重启恢复 | 首批 | DeskSuite 主进程存储；不继承参考项目 500 元素停存和卸载取消保存逻辑 | 首批 |
| E02 | 资源独立保存，场景只引用资产 ID | 首批 | 应用资产服务管理图片/视频/文档；临时 blob URL 仅作运行时地址 | 首批 |
| E03 | 导入时复制进画板资源库 | 首批 | 便携、原文件删除后仍可读取；消耗额外磁盘空间 | 不需要 |
| E04 | 引用原文件，外部修改后刷新 | 以后 | 与复制模式可并存；需要缺失文件提示、重新定位和 watcher | 以后 |
| E05 | 多个画板：新建、命名、切换、删除 | 首批 | 沿用 DeskSuite 多画板能力并补充命名契约 | 首批 |
| E06 | 画板打包导入导出（包含资源） | 首批 | 自建版本化便携包；保留视频/文档，区别于导出截图 | 以后 |
| E07 | 导出 PNG/JPEG 静态预览 | 以后 | 官方 export；视频仅封面/当前帧，DOM 阅读层需明确截图合成策略 | 首批 |
| E08 | 旧 Excalidraw 数据保留与迁移 | 首批 | 先备份旧格式，基础元素/图片转换；特殊形状不能无损迁移时保留旧板只读入口 | 不需要 |
| E09 | 文件管理器拖入、MCP 操作与验收入口 | 首批 | 自建 DeskSuite 插件集成，按现有文件/媒体能力服务注入 | 首批 |

### F · 高级候选功能

| 编号 | 功能 | 建议 | 能力来源与边界 | 用户选择 |
| --- | --- | --- | --- | --- |
| F01 | 图片裁剪 | 以后 | 社区裁剪插件或 PxGrow Clipper；先做简单矩形裁剪 | 首批 |
| F02 | SVG 导入与可编辑矢量导出 | 以后 | 社区 leafer-x-svg；需验证转换子集，不能等同完整 SVG 支持 | 不需要 |
| F03 | 动态数据图表 | 以后 | leafer-x-echarts；当前文档的交互描述与路线图有不一致，动画关闭 | 不需要 |
| F04 | 大图与超大场景加速 | 以后 | 先做缩略图/按需挂载；官方商业加速器或社区 WebGPU 插件须专项验证 | 以后 |
| F05 | 滤镜、特效文字、运动路径动画 | 不需要 | 官方及社区已有；对资料整理场景优先级低 | 以后 |
| F06 | 多边形/星形库、思维导图专用工具 | 不需要 | 参考项目已有部分元素；完整思维导图布局与操作仍需补充 | 不需要 |
| F07 | 多人实时协作 | 以后 | 未找到可直接满足本项目的现成整套方案；同步、冲突和资源服务需另外设计 | 不需要 |
| F08 | 专业路径/渐变/节点/遮罩编辑 | 不需要 | 社区或 PxGrow 商业编辑套件；超出轻量画板重点 | 不需要 |


## 9. 推荐的分期与需要先验证的事项

这份分期仅用于选择讨论，实施范围以用户回复为准。

- 第一阶段：引擎基础、稳定保存和资源管理；完成旧数据保留，先验证基础选择/平移/缩放与重启恢复。
- 第二阶段：图片 + 视频 + PDF/Markdown/TXT 原位展开；验证相机跟随、焦点/滚轮、阅读状态、视频 seek/音量、PDF 选字/搜索、离屏资源释放。
- 第三阶段：轻量标注、连线、分区与资料整理，补画板包导入导出。
- 后续阶段：根据选择添加 Office、批注写回、裁剪、图表或高级布局。

采用前必须形成实际证据：统一 Leafer 版本后的包安装/类型检查；Electron 打包后的视频解码和本地资源定位；PDF 中文/扫描页/大文件；Markdown 相对图片；多文档展开与至少一个视频播放下的响应性；保存失败及重启恢复。上述均未在本次纯调研中执行，不据此承诺性能或全部格式兼容。

## 10. 阅读路径

| 顺序 | 文档 | 关注点 |
| --- | --- | --- |
| 1 | [Leafer 指南](https://www.leaferjs.com/ui/guide/) | App、元素、坐标、事件、生命周期 |
| 2 | [视口](https://www.leaferjs.com/ui/plugin/in/viewport/) / [视图控制](https://www.leaferjs.com/ui/plugin/in/view/) | 平移缩放、fit、聚焦 |
| 3 | [Editor](https://www.leaferjs.com/ui/plugin/in/editor/) / [历史](https://www.leaferjs.com/ui/plugin/in/editor/Editor/history.html) | 选择变换、编辑事件与应用历史 |
| 4 | [Video](https://www.pxgrow.com/docs/plugin/official/video/) / [官方源码](https://github.com/leaferjs/leafer-in/tree/main/packages) | 视频及当前开源插件事实 |
| 5 | [参考画板项目](https://github.com/ZekoFront/leafer-free-board) | Core/History/Connection 的实现思路 |
| 6 | [社区目录](https://www.leafer.pro/#plugin) / [早期目录](https://www.leaferjs.com/ui/en/contribute/) | 按需求挑插件，不按目录批量安装 |
| 7 | [PDF.js](https://mozilla.github.io/pdf.js/) / [react-markdown](https://github.com/remarkjs/react-markdown) | 文档阅读与 Leafer 空间层的组合 |
