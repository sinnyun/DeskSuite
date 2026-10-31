# data-ops-annotations（主进程）

- 域 / 子类 / 名称：`data` / `ops` / `annotations`
- 入口：`index.ts`
- 注入：`db`、`ipc`、`mcp`
- 数据归属：catalog 数据库中的 `meta`、`tags`、`file_tags`；路径键使用 `paths.identity()`，不依赖文件索引。
- 迁移：`tag-materialized-path` 通过 `db.migrate()` 添加 `tags.path` 及索引。

## IPC 服务

服务名：`annotations`。

- `forPaths(paths)` 返回 `{ [输入路径]: { path, favorite, rating, note, tags[] } }`。
- `pathsForTag(tagId)` 返回该标签及其全部子孙标签分配到的文件路径，按路径排序。
- `counts()` 返回 `{ [标签id字符串]: 数量 }`（仅直接分配，不含子孙）。
- `setFavorite({ path, favorite })`、`setRating({ path, rating })`、`setNote({ path, note })` 写入路径元数据。
- `assignTag({ paths, tagId })` 与 `unassignTag({ paths, tagId })` 修改文件标签关系。
- `tree()` 返回按同级 `sort` 与 id 排序的树；节点包含物化 `path`。
- `create({ name, parentId?, color? })`、`rename({ tagId, name })`、`merge({ sourceId, targetId })`、`remove(tagId)` 管理标签树。
- `importLegacy(map)` 幂等导入旧渲染层元数据映射，返回 `{ imported, skipped }`。
- 数据库读取的标签树、路径元数据映射、标签计数和路径列表在离开 IPC/MCP handler 前经插件本地 Zod schema 校验；写操作确认值与导入计数也会校验。`annotations:changed` 广播在发出前校验。

## MCP 工具

- `tag_list`、`tag_files`（列出标签子树下的全部文件路径）为只读工具。
- `tag_create`、`tag_assign`、`meta_rate`、`meta_favorite` 为低影响 mutating 工具，由 MCP 服务统一执行权限闸门。
- MCP 失败文本统一使用共享限长错误格式化器，避免任意对象强制转换，并遮蔽凭据与本机绝对路径。

## 事件与限制

- 成功写入后广播 `annotations:changed`，payload 为 `{ kind: 'tree'|'metadata', paths?, at }`。
- 评分限整数 0–5；备注最多 20,000 字符；批量路径最多 1,000 项。
- 标签关系不依赖 `files` 或 `folders` 索引记录。
- 递归 CTE 记录已访问 id，防止树遍历陷入环；禁止把标签合并到自身后代。合并时源标签的子标签移到目标标签下并迁移文件关系；删除标签时子标签提升到原父标签。
- 不消费配置项。
