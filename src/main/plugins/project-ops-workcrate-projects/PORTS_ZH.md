+# PORTS — project-ops-workcrate-projects（主进程）

WorkCrate 工程登记、文件引用和便携工程数据的唯一主进程所有者。采用 DeskSuite 全新数据格式，不导入 FileAtlas 或其他旧程序数据。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `project` / `ops` / `workcrate-projects` |
| 入口 | `index.ts` |
| 注入 | `ipc`、`store`、`mcp` |
| Cordis 服务 | `workcrateProjects` |

## Cordis 服务契约

通过 `ctx.reflect.provide('workcrateProjects', service)` 发布。Boards 等主进程插件必须注入此服务，不得跨插件 import 文件。

- `list(includeArchived?) -> WorkCrateProject[]`
- `getPreferences() -> { projectSortOrder }` / `savePreferences({ projectSortOrder }) -> { projectSortOrder }`；偏好写入 WorkCrate 索引。
- `registerLifecycleHook({beforeDelete,beforeRelocate,beforeSetDocumentPath}) -> dispose` 注册 Boards 等消费者在删除、迁移/重新打开便携目录或重绑原生文档前关闭会话的生命周期钩子；提供方卸载时必须注销，钩子失败会阻止对应变更。
- `get(projectId) -> { project, references, fieldPresets, documentPath, documentBinding }`
- `projectDirectory(projectId) -> 绝对路径`
- `create(name)`、`rename(projectId,name)`、`setArchived(projectId,archived)`、`reorder(projectIds)`、`duplicate(projectId,name?)`、`delete(projectId)`
- `addReferences(projectId,paths)`、`removeReference(projectId,referenceId)`、`relinkReference(projectId,referenceId,path)`、`updateReference(projectId,referenceId,{displayTitle?,order?})`
- `setCover(projectId,path)`、`removeCover(projectId)`、`setReferencePreview(projectId,referenceId,path)`、`removeReferencePreview(projectId,referenceId)`、`readPreview(projectId,relativePath)`
- `getDocumentPath(projectId)`、`documentBinding(projectId)`、`setDocumentPath(projectId,path)`、`clearDocumentPath(projectId,expectedPath)`
- `relocateProject(projectId,directory)`、`openProjectFolder(directory)`
- `getProjectPresets(projectId)`、`saveProjectPresets(projectId,presets)`、`getProgramPresets()`、`saveProgramPresets(presets)`、`effectivePresets(projectId?)`、`promoteProjectField(projectId,key)`

DTO：

- `WorkCrateProject = { id, name, createdAt, archived, mainImage, order? }`；`createdAt` 是 Unix 毫秒时间，`order` 用于项目列表排序。
- `WorkCrateFileReference = { id, path, displayTitle, order, sizeBytes, modifiedAt, customPreview, available? }`；get 返回的 `available` 为实时文件存在状态，path 是规范化后的外部源路径，添加/重新关联不会复制源文件。
- `WorkCratePreview = { path, sha256, width, height }`；path 相对于工程目录，指向插件拥有的 JPEG/PNG 副本。
- `WorkCrateFieldPresets = { fields: Array<{ key, label, values: string[] }> }`。

## 渲染层 IPC

服务名：`workcrateProjects`。

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `list` | `includeArchived?: boolean` | `WorkCrateProject[]` |
| `getPreferences` / `savePreferences` | 读取 / `{ projectSortOrder: manual\|name-asc\|name-desc\|created-newest\|created-oldest }` | `{ projectSortOrder }` |
| `get` | `projectId` | `{ project, references, fieldPresets, documentPath, documentBinding }` |
| `create` | `name` | `WorkCrateProject` |
| `rename` | `{ projectId, name }` | `WorkCrateProject` |
| `setArchived` | `{ projectId, archived }` | `WorkCrateProject` |
| `reorder` | `{ projectIds: string[] }` | `WorkCrateProject[]`；只重排请求列表中的现有项目，并使用它们原有排序槽位 |
| `duplicate` | `{ projectId, name? }` | `WorkCrateProject`；复制工程数据、预览和已关联的原生文档，不复制引用源文件 |
| `delete` | `projectId` | `void` |
| `addReferences` | `{ projectId, paths: string[] }` | `WorkCrateFileReference[]` |
| `removeReference` | `{ projectId, referenceId }` | `WorkCrateFileReference[]` |
| `relinkReference` | `{ projectId, referenceId, path }` | `WorkCrateFileReference[]` |
| `updateReference` | `{ projectId, referenceId, displayTitle?, order? }` | `WorkCrateFileReference[]`；order 表示目标位置 |
| `setCover` | `{ projectId, path }` | `WorkCratePreview` |
| `removeCover` | `projectId` | `void` |
| `setReferencePreview` | `{ projectId, referenceId, path }` | `WorkCratePreview` |
| `removeReferencePreview` | `{ projectId, referenceId }` | `void` |
| `readPreview` | `{ projectId, relativePath }` | `{ dataUrl, mimeType, width, height }`，JPEG，边长不超过 1200 px，最大 8 MiB |
| `getDocumentPath` | `projectId` | `string | null` |
| `setDocumentPath` | `{ projectId, path }` | `{ path, binding }` |
| `clearDocumentPath` | `{ projectId, expectedPath }` | `void` |
| `relocateProject` | `{ projectId, directory }` | 新的工程数据绝对目录 |
| `openProjectFolder` | `directory` | 重新登记的 `WorkCrateProject[]` |
| `getProjectPresets` / `getProgramPresets` | `projectId` / 无 | `WorkCrateFieldPresets` |
| `saveProjectPresets` | `{ projectId, presets }` | 规范化后的字段预设 |
| `saveProgramPresets` | `presets` | 规范化后的字段预设 |
| `effectivePresets` | `projectId?` | 工程优先、合并程序默认值 |
| `promoteProjectField` | `{ projectId, key }` | 更新后的程序字段预设 |

渲染层必须调用 `readPreview`；不得读取 userData 内文件。写入后广播 `workcrateProjects:changed`，payload 为 `{ projectId, revision, at }`。

## 持久化和路径边界

- 最近工程索引：`<userData>/data/workcrate/recent.json`，由主进程 `store` 管理并使用原子写入和版本信封。
- 新工程最初创建在 `<userData>/data/workcrate/projects/<uuid>/`。用户明确创建/关联原生文档后，可把插件拥有的数据重定位至 `<所选目录>/.workcrate/<uuid>/`；索引保存工程数据绝对位置。
- 工程数据为版本化 `project.json`，预览位于 `previews/`。JSON 通过同目录临时文件写入并保留失败恢复备份。重定位先复制到临时同级目录并验证 ID，再原子发布、更新定位索引，最后清理旧的插件数据。
- 复制、重定位、重新打开便携目录和删除前，会校验工程文档及所有登记预览的摘要；递归复制遇到符号链接或重解析点时会报错，不会静默漏掉工程数据。
- `openProjectFolder` 仅检查用户指定目录内的 `.workcrate/<uuid>/`，完整验证候选项目后才更新索引；不扫描磁盘。
- 删除先把插件拥有的数据复制到 `<userData>/data/workcrate/trash/`，再移除已登记工程目录。外部引用源文件和已关联原生文档永不由本插件删除或移动。
- 预览读取必须命中当前登记的封面/自定义预览，解析符号链接后仍位于规范工程目录下，并重验 SHA-256。只接受 JPEG/PNG；输入文件最多 32 MiB，返回给渲染层的图像最多 8 MiB。
- 引用只接受已存在的普通文件并存储规范绝对路径；重复路径忽略。重新关联只改引用记录。
- 字段预设限制字段和值的数量及长度；字段 key 重复时报错，重复值去重。
- 删除封面仅删除工程拥有的预览副本。`duplicate` 会复制工程 JSON、预览和已关联的原生文档，生成新的工程/引用/binding ID，并保留外部引用路径。复制原生文档到用户所选目录由 Boards 提供格式专用的受控流程。
- 便携定位只能是应用私有项目根下的 UUID 目录，或所选目录 `.workcrate/<同一 UUID>`；登记目录、`.workcrate` 父目录和工程目录拒绝符号链接/重解析点，避免索引污染诱导任意路径复制或删除。
- 引用在 `get` 返回时实时检查源文件状态；缺失引用仍保留，可通过重新关联恢复。
- `clearDocumentPath` 会将期望绝对路径与已保存的规范路径比较；即使原生文档已从磁盘删除，也能清除过期关联。

## MCP 工具

| 工具 | 权限 | 显式确认 |
| --- | --- | --- |
| `workcrate_projects_list`、`workcrate_project_get`、`workcrate_project_references`、`workcrate_project_presets_get`、`workcrate_program_presets_get`、`workcrate_project_presets_effective`、`workcrate_project_document_get` | 只读 | 无 |
| `workcrate_project_create` | Mutating，standard | 无；只在应用 `userData` 下新建工程 |
| `workcrate_project_rename`、`workcrate_project_archive`、`workcrate_project_duplicate`、`workcrate_projects_reorder`、`workcrate_project_add_references`、`workcrate_project_remove_reference`、`workcrate_project_relink_reference`、`workcrate_project_reference_update`、`workcrate_project_set_cover`、`workcrate_project_remove_cover`、`workcrate_project_set_reference_preview`、`workcrate_project_remove_reference_preview`、`workcrate_project_presets_save`、`workcrate_program_presets_save`、`workcrate_project_presets_promote`、`workcrate_project_document_set`、`workcrate_project_document_clear`、`workcrate_project_open_folder` | Mutating，standard | 每个工具都要求 `confirm: true`；未传或为 false 时处理器拒绝。便携工程目录可能位于应用目录之外。 |
| `workcrate_project_delete`、`workcrate_project_relocate` | Mutating，高影响 | 两个工具都要求 `confirm: true`；未传或为 false 时拒绝。它们可能在外部便携目录发布或移除插件拥有的数据。 |

所有 mutating 工具还服从已配置的 MCP 访问等级（standard 或 full；高影响要求 full）。`confirm: true` 是额外的单次调用要求。引用、预览、关联、删除和重定位工具不会写入源文件或原生文档；重定位仅移动 WorkCrate 自有工程数据。

Boards 插件拥有原生文档/画板数据及官方 VectorCraft CLI 调用；Projects 仅保存用户明确建立的文档关联和 binding UUID。

## 物料基础信息

IPC `workcrateProjects` 提供 `getProgramPresets()`、`saveProgramPresets(presets)` 和 `effectivePresets(projectId?)`。MCP 提供 `workcrate_program_presets_get()`、`workcrate_program_presets_save({ presets, confirm: true })`；保存需要写权限，经校验和去重后完整替换字段列表，并广播 `workcrateProjects:changed`。

首次初始化时，recent.json 中的 `materialDefaultsVersion` 升为 1；补齐缺失的 9 类字段、83 个选项：物料类别、物料名称、尺寸标签、尺寸、数量、材质、制作工艺、颜色、安装方式。已有同键字段及选项不覆盖；后续主动删除或清空的内容在重启后也不会重新填入。基础信息不自动覆盖工程物料值。
