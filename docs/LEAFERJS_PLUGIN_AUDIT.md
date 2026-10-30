# LeaferJS 插件目录与白板迁移盘点

盘点日期：2026-10-29  
项目 Leafer 版本：`leafer-ui` 与已集成官方插件均锁定 `2.3.2`；社区依赖见根目录 `package.json`。  
用途：区分 Leafer 官方插件、官方社区目录收录的第三方项目，以及 DeskSuite 白板中仍由产品层维护的实现，并为后续迁移排序。

## 结论摘要

### 当前实现（2026-10-29，增量同步与原生文本/组合优化之后）

- 官方 Viewport/View/Editor/Resize/Export/Arrow 的实际调用已核实；社区 ClipImage/ClipResizeEditor、Snap、Ruler 的职责保持不变。
- TextEditor 2.3.2 现为直接锁定依赖。纯文本和便签采用单个原生 Text 与官方内部编辑器，不再经过 rich-layout 分词排版；作用域内的 IME 按键保护不拦截浏览器组合输入默认行为。显式富文本模式保留 HTML 净化及旧排版兼容，转换会先提交原生输入。
- SceneService 对未变节点、数组和其他场景分支做结构共享。engine.sync 依据引用判定变更，不再对每次保存/选择/视图通知序列化或扫描全量节点。兼容实例原位更新；表示类型、折叠或图片源变化才按需重建。
- 分组使用真实原生 Group，Editor.group/ungroup/openGroup/closeGroup 执行编解组及进出组；支持嵌套、组内单选、层级图层及嵌套剪贴板。scene.groups 保存父级与画板坐标变换，叶节点保持画板坐标；Matrix/dropTo 负责分解/换父级，组旋转控制框方向得以保留。旧扁平 group ID 仍可读。
- MCP 验证入口见 scripts/verify/board-native.mjs：节点实例、通知零节点扫描、官方文字编辑、组变换/层级/历史/剪贴板、富文本切换、导出及重启；计数可通过 renderState.sync/nodeInstances/groups 检查。保存/结构共享/校验/IME 守卫的确定性检查见 board-save.mjs。
- 自写代码保留于业务历史/资源/MCP/保存、富文本子集、小地图、背景及排列等产品层；Find/Scroll/State 等仍按需评估。下面的候选清单中，文本编辑与组合项以上述已完成状态为准。

- 目前已使用官方 Editor、Export、Viewport、View、Arrow，以及社区 Easy Snap、Clip Resize Inner Editor；图片裁剪已由裁剪插件负责，箭头尖端由官方 Arrow 绘制。不要在外层再写裁剪几何或箭头几何算法。
- 第一阶段已完成视口迁移：官方 `@leafer-in/viewport` 与 `@leafer-in/view` 均以 2.3.2 安装；design 视口接管滚轮/触控板与 Space/中键平移缩放，view 插件接管 fit/zoom，zoomLayer 变化写回持久化 `scene.view`。
- 已接入 `leafer-x-ruler` 2.0.1 绘制标尺刻度和选中对象标记；React 只保留拖动热区及 DeskSuite 持久化参考线覆盖。参考线仍通过场景命令写入，并由 Easy Snap 对齐。
- 富文本渲染已检查官方 `@leafer-in/html`：HTMLText 仅测量自然内容并经 SVG foreignObject 作为图片绘制，节点固定宽度会缩放而非约束换行，因此不能替代当前节点框排版；该包未保留为依赖。`@leafer-in/text-editor` 已接管原生纯文本/便签编辑；HTML 富文本子集继续保留兼容实现。
- Leafer 插件不是白板业务模型：撤销重做、剪贴板、资源租约、验证、自动保存、MCP 命令、书签、分区关系仍归 DeskSuite 场景事务所有。Editor 的历史仅在它可被可靠序列化并纳入同一事务后才可替换对应实现。
- 官方社区目录是推荐/展示列表，不等于 Leafer 官方维护或对当前 `2.3.2` 的兼容承诺；本清单的社区插件需在集成前核实 peer dependency、插件生命周期、事件/API 与版本兼容。

## 官方插件目录

官方插件中心当前列出以下插件/能力。包名按官方插件文档的惯例给出；具体安装版本需要与 `leafer-ui` 一致。`leafer-editor` 是预集成包，可一次引入多项官方能力，但当前项目用模块化包，迁移前不应改成整包而未评估 bundle 和重复插件注册。

| 官方能力 | 常见包名 | 能力摘要 | DeskSuite 白板关系 |
| --- | --- | --- | --- |
| 图形编辑器 | `@leafer-in/editor` | 选择、框选、多选、移动、缩放、旋转、倾斜、编组、层级、锁定、快捷键、内部编辑器 | 已安装。继续作为画布对象的临时交互/变换入口；与场景持久化命令保持单一提交路径。 |
| 视口 | `@leafer-in/viewport` | 滚轮/触控板平移缩放、design 类型支持 Space/中键拖拽 | **已安装并迁移**。`tree.type='design'` 接管画布 pan/zoom；zoomLayer 属性事件按帧写入 `scene.view`，React 覆盖层跟随场景状态。 |
| 视图控制 | `@leafer-in/view` | zoom、fit、fit-width/height、聚焦元素/区域 | **已安装并迁移**。MCP fit/zoom 与顶部缩放按钮调用插件；空场景复位、view 持久化和界面同步由 DeskSuite 适配。 |
| 滚动条 | `@leafer-in/scroll` | 无限画布水平/垂直滚动条及主题 | 可选候选。当前白板没有滚动条；若产品需要再引入。 |
| 箭头 | `@leafer-in/arrow` | 线条起止箭头与内置箭头样式 | **已迁移**。白板 arrow 节点使用官方 Arrow/endArrow，普通 line 仍用 Leafer Path；场景 schema 保持不变。 |
| HTML | `@leafer-in/html` | `HTMLText` 通过 SVG foreignObject 嵌入 HTML 并按自然内容尺寸生成图片 | **已评估，不适合替换当前固定尺寸节点的富文本布局**：实现测量无宽度约束的 DOM 内容，指定节点宽度会缩放图片，无法保持容器内换行；DOMPurify 仍是必要安全边界。 |
| 文本编辑 | `@leafer-in/text-editor` | 双击文本进入编辑，依赖 Editor | **纯文本/便签已接入**官方 TextEditor；显式 HTML 富文本保留原 DOM 输入层。 |
| 运动路径 | `@leafer-in/motion-path` | 元素沿路径运动 | 白板没有动画/路径运动需求，不迁移。 |
| Robot | `@leafer-in/robot` | 游戏精灵帧播放与动作 | 与白板产品范围无关。 |
| 交互状态 | `@leafer-in/state` | hover、press、focus、selected、disabled 样式状态 | 可用于画布节点状态效果；目前选择外框已由 Editor 管理，非高优先级。 |
| 查找元素 | `@leafer-in/find` | 在 Leafer 树查找元素 | 不能完全替代 `commands.ts` 的业务搜索（名称、文本、tags 和场景 ID）；可用于引擎树内的技术查找。 |
| 导出 | `@leafer-in/export` | 元素导出及画面截图 | 已安装。继续用于 PNG/JPEG、节点缩略图；外层下载与产品命令保留。 |
| 滤镜 | `@leafer-in/filter` | 图形滤镜 | 当前无对应功能，按需增加。 |
| color | `@leafer-in/color` | 色彩能力扩展 | 当前无明确白板功能映射，按需增加。 |
| resize | `@leafer-in/resize` | 将缩放变成宽高/路径/字号尺寸调整 | Editor/Flow 可间接使用；若白板要提供原生尺寸编辑，优先评估此插件而非自算节点几何。 |
| 高亮元素 | `@leafer-in/highlight` | 在画布中突出显示元素 | 可用于搜索结果/定位反馈；不替代 DeskSuite 的名称/文本/tags 搜索索引。 |
| scale-fixed | `@leafer-in/scale-fixed` | 在缩放视图中保持指定元素/属性的屏幕尺寸 | 可评估标尺、辅助线或编辑器控制装饰的缩放表现；不替代 view 状态或 DOM 层同步。 |
| Flow 自动布局 | `@leafer-in/flow` | 类 Flex 的自动布局、方向、换行、对齐、间距、内边距 | 可用于新增自动布局容器；不能直接替换当前一次性的 arrange/distribute 命令。官方资料仍有 alpha/内测说明，需先确认版本与可用性。 |
| Animate | `@leafer-in/animate` | 延迟、循环、seek、关键帧、过渡 | 白板当前无动画需求，不迁移。 |

> `leafer-editor` 官方整合包文档列出 Editor、Text Editor、Viewport、View、Scroll、Arrow、HTML、Find、Export、Scale Fixed 等插件。`@leafer-in/scale-fixed` 也可用于缩放时保持控件/线宽尺寸；目前未发现白板中需要专门接管的实现。

## Leafer 社区与 GitHub 插件目录

Leafer 官网插件中心和 `leaferjs/leafer-x` 是社区插件展示/提交入口。官网明确将官方插件与社区插件分区；`leafer-x` 仓库将自身定位为第三方插件与上层应用中心。表中“目录收录”表示官网社区页提及，不表示官方维护者编写或保证版本兼容。

### 与当前白板直接相关的候选

| 插件/仓库 | 目录与能力证据 | 白板映射 | 迁移判断 |
| --- | --- | --- | --- |
| [leafer-x-easy-snap](https://github.com/Xdy1579883916/leafer-x-easy-snap) / npm `leafer-x-easy-snap` | 官网社区插件列表收录；仓库称提供元素移动吸附和对齐辅助线。当前锁定 `1.11.0`。 | 元素移动吸附、对齐线、间距辅助线 | 已接入，继续作为唯一吸附算法。DeskSuite 可把持久标尺作为插件 snap 目标，避免第二套几何算法。 |
| [leafer-x-clip-resize-inner-editor](https://github.com/Xdy1579883916/leafer-x-clip-resize-inner-editor) / npm 同名 | 官网社区插件列表收录；仓库说明图片裁剪内部编辑器支持移动、缩放、旋转、拉伸。当前 `^1.10.0`。 | 图片裁剪 | 已接入。双击确认后的比例/位置应由该插件 child-image transform 以及序列化适配负责；外层只保存插件状态，不能二次压缩或重算 crop。 |
| [leafer-x-ruler](https://github.com/LvHuaiSheng/leafer-x-ruler) / npm `leafer-x-ruler` | 官方社区名录收录；npm 2.0.1，peer `@leafer-ui/core: ^1.2.2 || ^2.0.0`，依赖 Editor/TextEditor/Core `^2.0.4`；实际由当前锁文件解到 2.3.2。 | 刻度与选中对象标记；不提供 DeskSuite 持久化 guide 命令 | **已迁移刻度绘制**。Leafer 新增 layer 绘制刻度/选区高亮；React 只保留 pointer 热区与 guide 预览/持久化叠层，Easy Snap 仍消费场景 guide。 |
| [leafer-x-path-editor](https://github.com/xjq7/leafer-x-path-editor) / npm 同名 | 官网社区插件列表收录；仓库描述为基于 Path 的图形编辑器。 | 当前没有明显的路径节点编辑器 | 适用于未来钢笔/贝塞尔路径编辑，不是通用形状 Editor 替代。 |
| [leafer-connector](https://github.com/rideWind97/leafer-connector) / npm 同名 | 官网社区列表收录连接线；README 描述节点端点、正交/贝塞尔/直线/自定义路由、箭头、label、状态同步，依赖 `leafer-editor`。 | 当前 line/arrow 基础图形；未来节点连接/流程图连线 | 可迁移增强型节点连线，但需将连接关系、端点引用、路由结果纳入 scene schema/history。当前自由线条不必强制替换。 |
| leafer-x-guide-line（官网社区目录中的赞助版吸附线） | 官网社区目录列为赞助项目，当前入口指向赞助页面，未据此确认公共仓库和 npm 包。 | 参考线吸附 | 先确认仓库、授权和安装可用性；现有 Easy Snap + 持久 guide 已覆盖核心需求，不建议叠加第二吸附系统。 |
| [leafer-x-edit-toolbar](https://www.npmjs.com/package/leafer-x-edit-toolbar) | 官网列有社区 toolbar，npm 包链接可用。 | 选择对象的快捷浮动工具栏 | 仅视图/UI 组件候选；DeskSuite toolbar 按 scene commands 触发，不可接管业务命令或 IPC。需检查包 README 与 2.3.2 兼容性。 |
| [leafer-x-dot-matrix](https://www.npmjs.com/package/leafer-x-dot-matrix) | 官网插件中心链接到此 npm 包，社区参与页还列无限点阵项目。 | 当前 dots/grid/none 背景绘制 | 候选，适合替换画布背景的视觉绘制；背景类型及用户设置仍由 DeskSuite 场景保存。 |
| leafer-x-snap | 官网社区参与页列出另一款 `leafer-x-snap`；此轮未确认精确仓库或包入口。 | Easy Snap 的替代方案 | 不建议叠加。只有 Easy Snap 存在无法满足的需求且确认包、API、版本兼容时才做对照替换。 |

### 官网社区目录中的其他项目

社区目录还列出 `leafer-x-dotwuxian`（无限点阵）、`leafer-canvas-player`（视频播放）、`leafer-x-effect-text`（特效文字）、`leafer-x-echarts`（ECharts）、`leafer-x-polyline-editor`（折线编辑）、`leafer-x-tooltip` / `leafer-x-tooltip-canvas`、`leafer-vue`、`leafer-unified`、`leafer-flex-plugin`，以及 PDF、签名、AI 图像识别等旧项目。它们均属社区/第三方生态能力，不是自动适用于本白板的官方插件。

- [leafer-canvas-player](https://github.com/rideWind97/leafer-player) 可研究视频节点在 Leafer 树内的播放/帧渲染；README 使用 `<video>` 作为帧源并提供自带控件，依赖 `leafer-editor` 与 Flow。要先确认 Electron 解码能力、静态导出当前帧、DeskSuite 资源 URL 与生命周期；现阶段不宜直接删除现有原生 `<video>`。
- `leafer-x-polyline-editor` 与 `leafer-x-path-editor` 面向特定路径编辑工具，适合未来路径功能，不替代常规节点编辑。
- Tooltip、效果文字、ECharts、Vue 封装、PDF/签名/AI 识别与当前白板的手写核心职责不重叠。
- 名称只在社区文章中出现、不能从官网插件中心或 `leafer-x` 官方仓库解析到项目根链接的项目，本文不推断其仓库地址或兼容性。

## DeskSuite 当前实现与迁移矩阵

| 当前能力 / 位置 | 当前实现性质 | 合适插件 | 判断与边界 |
| --- | --- | --- | --- |
| 节点选择、拖动、框选、变换、锁定/层级交互（`engine.ts`） | Editor 集成及场景适配 | `@leafer-in/editor` | **已使用**。检查所有操作最终单次写入 `board.edit`；不要另建手工控制框/拖拽实现。 |
| 移动自动吸附、对齐辅助线、距离标签、等间距提示 | 社区插件集成，持久化 guide 作为吸附候选 | `leafer-x-easy-snap` | **已使用**。这些移动期间的吸附与视觉提示均由插件负责；继续清理任何遗留自写 snap 距离/吸附算法。 |
| 图片裁剪/内部编辑（`ClipImage` + inner editor） | 插件原生裁剪 + DeskSuite 持久化适配 | `leafer-x-clip-resize-inner-editor` | **已使用**。核查双击确认只保存插件原生 child transform；禁止把图像重新按裁剪框等比 fit。产品层负责旧数据迁移和撤销提交。 |
| 画布导出、单节点透明缩略图（`engine.ts`） | 插件导出调用 + 下载/产品接口 | `@leafer-in/export` | **已使用**。保留产品层选择格式、下载、尺寸限制和 UI。 |
| fit、缩放、Leafer 视口变换/`scene.view` 同步 | Leafer View 插件 + DeskSuite 状态适配 | 官方 `@leafer-in/view`、`@leafer-in/viewport` | **已迁移**。fit/zoom 交给插件；engine zoomLayer 变化回写 scene.view，DOM 内容、React 坐标层、小地图与 MCP 使用同一状态。 |
| wheel 平移、Ctrl/Meta-wheel 缩放、Space/中键拖拽（`viewport.tsx`） | Leafer design 视口插件 | `@leafer-in/viewport` | **已迁移**。`viewport.tsx` 不再维护 wheel、pointer pan 或其坐标数学；保留场景快捷键与编辑输入豁免。 |
| 移动、缩放、旋转、翻转、角点比例 resize | Leafer Editor/Resize 几何 + 场景事务适配 | `@leafer-in/editor`（依赖 `@leafer-in/resize`） | **已收敛**。编辑器交互和 toolbar rotate/flip 均调用 Leafer Editor；Resize 由 editor 依赖提供。引擎只把最终 UI transform 映射进 scene 并一次提交，禁止重复手算变换几何。 |
| React 标尺刻度与选区标记（`Rulers`） | Leafer plugin layer | `leafer-x-ruler` | **已迁移**。插件负责刻度与选中对象标记；React 只提供拖动热区和持久化 guide 的临时/显示叠层。 |
| 持久化参考线拖动/双击删除（`Rulers`） | React pointer adapter + scene command | DeskSuite 场景事务、`leafer-x-easy-snap` | 保留业务适配：插件不暴露可接回 DeskSuite guide CRUD 的交互回调。 |
| 小地图及点击跳转（`Minimap` SVG） | 手写 React/SVG 展示和坐标换算 | 暂未发现官方目录中直接匹配的插件 | **暂留/调研**。可以在 Leafer 场景导出缩略图+视口框，但 React 小面板布局、scene 信息和持久视口属于产品 UI；未找到可靠插件前不应为“去手写”而换无关包。 |
| 点阵/网格背景 | CSS/React overlay 或画布底层背景处理 | 社区 dot-matrix 插件 | **可评估视觉层替换**。数据值和设置事务不迁移；先验证无限平移缩放与性能。 |
| 文本/便签 HTML 的 sanitize、手写换行、canvas measureText、拆分 Leafer Text runs（`rich-layout.ts`） | 明确的自写排版引擎 | `@leafer-in/html`、`@leafer-in/text-editor` | **评估后暂留**。HTMLText 自然尺寸图片模型不支持固定框自然换行；TextEditor 不能直接覆盖现有 HTML 子集。保留净化、搜索、固定框和导出一致性契约，待出现支持受限宽度富文本流排版的兼容插件再迁移。 |
| 浏览器 `contenteditable` 编辑 overlay | React DOM 输入层 | `@leafer-in/text-editor` 或官方 HTML 插件 | **纯文本/便签已迁移**。官方 TextEditor 负责输入，IME 组合键保护、提交及业务历史由适配层处理；显式 HTML 子集仍保留原 DOM 编辑器。 |
| 视频播放、DOM `<video>` 与帧画到 Leafer Canvas | 产品播放器/渲染适配 | 社区 `leafer-canvas-player`（待验证） | **暂不替换**。它涉及 Electron codec、原生控件、资源 URL、导出当前帧、生命周期的具体承诺尚未核实；试用必须对照这些行为。 |
| add/copy/paste/duplicate/delete、undo/redo、group/ungroup、frame、lock、z-order、批量 arrange/distribute | `commands.ts` 产品命令和场景事务；移动时的对齐吸附及等间距提示 | `@leafer-in/editor`、`leafer-x-easy-snap` | **职责分开**。Easy Snap 负责移动期间自动吸附、对齐辅助线、距离/等间距提示；批量排列/等距命令负责重排 scene 并纳入历史。不得将任一侧移出其当前职责或跳过场景事务。 |
| 书签、场景搜索、背景设置、guide CRUD、交互模式、资源拖放/剪贴板导入 | DeskSuite 领域命令、产品 UI、IPC/MCP | 无直接 Leafer 插件替代 | **保留 DeskSuite 插件实现**。Leafer 插件只参与绘制或编辑，不拥有白板数据与操作权限。 |

## 推荐迁移顺序

1. **视口控制**：集中使用官方 View/Viewport，先覆盖 wheel、Space/中键 pan、指针中心 zoom 和 fit；以 `scene.view` 作为持久状态单一事实来源。
2. **文本渲染/编辑**：验证官方 HTML 与 Text Editor 能否覆盖现有支持的 HTML 子集、中文排版、DOM 编辑、导出。若只能覆盖显示或输入其中一端，分阶段替换对应算法并保留适配层。
3. **标尺组件**：已接入 `leafer-x-ruler` 替换刻度绘制；持久线继续走 guide scene command，再参与 Easy Snap。
4. **变换与尺寸**：已清理自写的旋转/翻转几何；Editor + Resize 执行交互与 toolbar 变换，持久化适配将最终 transform 原子写入 scene。排列/等距继续由 DeskSuite 命令管理。
5. **背景/连接线等按需能力**：点阵背景可低风险实验；Connector 在 scene schema 明确边引用和 undo 事务后再接入。
6. **评估后再处理小地图、视频**：当前未找到证据充分且等价的插件，先明确产品行为并检查仓库/版本。

## 兼容性与证据说明

- 项目基线以仓库 `package.json` 为准；安装版本为 Leafer `2.3.2` 系列。不要从社区页出现过某项目推断它支持 `2.3.2`。
- 官方插件名称与职责依据[官方插件中心](https://www.leaferjs.com/ui/plugin/)和[官方编辑器安装指南](https://www.leaferjs.com/ui/en/guide/install/editor/start.html)；视口、视图控制和文本编辑安装/API 分别见官方[viewport](https://www.leaferjs.com/ui/plugin/in/viewport/)、[view](https://www.leaferjs.com/ui/plugin/in/view/)、[TextEditor](https://www.leaferjs.com/ui/plugin/in/text-editor/)文档。TextEditor 文档注明目前仅支持 Web PC；DeskSuite 的 Electron renderer 满足 Web PC 运行形态，但 IME、导出和当前 HTML 子集仍需实测。resize/export/Flow 等细节见官方[resize](https://www.leaferjs.com/ui/en/reference/UI/resize.html)、[export](https://www.leaferjs.com/ui/en/reference/UI/export.html)、[Flow](https://www.leaferjs.com/ui/guide/plugin/flow/)文档。
- 社区插件名录依据[官方社区参与目录](https://www.leaferjs.com/ui/en/contribute/)；社区项目仓库 README/npm 是 API、包版本和依赖判断的次级证据。官网推荐收录和 GitHub 仓库所有权不表示官方兼容承诺。
- 当前清单是功能适配审计，不是对候选插件的安全审查或集成验证。安装前仍需读取 lockfile 对应的 peerDependencies、API 文档/源码、issue 与发布记录；对于版本不符的插件先做隔离试验。
