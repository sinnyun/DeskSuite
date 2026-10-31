# PORTS — data-ops-explorer-versions

Lore 文件历史界面。Lore 内容和版本信息由主进程插件持有。

## 元数据与贡献

- 域 / 子类 / 名称：`data` / `ops` / `explorer-versions`。
- 向 `sidebar.right.tabs` 和 `sidebar.right.content` 贡献 ID `versions`。
- 消费 Explorer 的 `selection` 服务；服务缺失或没有选中文件时显示空状态。
- 时间线合并 `versions.list(path)` 与 `versions.branchGraph(path, true)` 中的提交，按不可变版本 ID 去重并标出所属分支；其他或已归档分支的历史也能从同一列表恢复。

## 主进程 IPC

消费 `versions.list(path)`、`preview(path,versionId)`、`state(path)`、`create(path,title)`、`restore(path,versionId,confirm)`、`abandonInterruptedRestore(path,versionId,confirm)`、`branchGraph(path,includeArchived?)` 和 `branchAction(path,action,confirm)`。预览通过 IPC 返回有大小上限的 data URL，渲染层不读取 userData 路径。历史变更事件经 120 毫秒的同路径调度器合并后只触发一次完整刷新；`kind: "source"` 仅刷新状态。对应 `job:done` 只更新任务提示和错误，不重复触发完整刷新。预览结果和进行中的请求按路径及不可变版本 ID 缓存。选择路径变化后会丢弃旧的刷新与预览结果。

恢复前在界面要求确认；主进程还会检查禁止目录与未保存修改，本地操作不会扩大 MCP 可写根。若恢复中断，面板只提供对应目标的“继续恢复”；原文件字节已被外部改写时，用户可确认“解除恢复阻塞并保留当前文件”，该操作不改写源文件。MCP 写操作另由宿主 MCP Full 权限门控及调用确认控制；解除阻塞仅删除内部恢复日志，不要求源路径位于 MCP 写入根。

面板采用紧凑白灰卡片层级：状态/当前版本摘要、紫色保存区、带竖向节点线的版本时间线，以及以紫/青/灰节点区分当前、活动和归档分支的版本图。中断恢复提示保留两条安全操作及适用条件：原文件未变或已等于目标时可继续；确认外部改写后可解除阻塞并保留当前文件。源文件不可用时显示诊断并禁用两种操作。所有可见文案使用中文；内容在宿主右侧边栏内滚动。

后台版本任务失败后清除“任务已提交”通知，并重新读取中断恢复状态后展示真实错误。

普通列表/状态/分支图刷新（包括面板重开、渲染进程重启）只读取持久数据库。新增显式 versions.reconcile(path,true) 用于旧历史或同步失败，界面不会自动调用；待同步和文件失联分别显示中文状态。实际版本操作先更新持久化信息再发布完成事件。

界面变更操作处理 requiresApproval 命令计划，经批准/执行后才读取 jobId；恢复和解除阻塞复用已有确认。版本说明可空，保存按钮不因空说明禁用，由主进程自动命名。任务完成清除提交提示。

取消确认正常结束，不显示失败提示。
