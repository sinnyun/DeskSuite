# data-ops-explorer-grouped

- 域 / 子类 / 名称：data / ops / explorer-grouped；入口 index.tsx。
- 提供渲染层服务 `explorerGroupedView`：`component`、`toolbarComponent`、`configure({ groupBy?, includeChildren? })`、`getOptions()`。
- 可选消费 `panes`：活动 store 的 `getState().groupingEnabled`、`subscribe`、`setGroupingEnabled(boolean)`；缺失时分组控件降级。
- 经 ui 获取原语；消费 filesystem.listDir/listMore 递归读取目录。不直接注册 IPC、MCP 工具。

本插件只负责独立于卡片/列表/画廊的外层分组布局。组件契约接收 entries/allEntries/path、filterEntries、prepareEntries、registerEntries、getRating 和 `renderGroup(entries): ReactNode`。区块划分、折叠由本插件负责；区块内具体视图、选择、缩略图和原生文件拖出由资源管理器负责。切换内容视图不卸载分组布局，保留折叠状态。

支持类型、修改分钟、评分、所在文件夹分组，保持传入条目排序；类型固定分组顺序，文件夹从当前目录开始。递归上限 500 目录 / 25000 条目。分组方式与递归范围在渲染内存共享；分组开关是每窗格的独立持久化状态。开启/关闭分组不修改内容显示模式。

工具栏以独立分组开关配合三种内容视图按钮，分组说明合并进下拉框，提供仅当前目录/包含子目录切换。中文界面，28px 控件，适配明暗主题。

可选 `renderLayout(navigation): ReactElement` 将分组滚动区组合进更大布局，同时保持分组组件挂载。画廊左侧是分组单列卡片导航，右侧只有一个全局查看区；此时 renderGroup 只渲染卡片，不创建分组内画廊。
