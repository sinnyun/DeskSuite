# data-provider-version-info

Lore 文件历史插件的类型化元数据提供方。元数据存储在 DeskSuite 共享 catalog 数据库中；版本内容由 Lore 管理。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `data` / `provider` / `version-info` |
| 入口 | `index.ts` |
| 依赖 | Cordis 服务 `db` |
| 提供服务 | `versionInfo` |

## 存储

- 通过 catalog migration API 在 `desksuite.db` 中拥有 `version_entities`、`versions`、`version_graph` 三张表。
- 实体 ID 使用新生成的 UUID。规范化路径身份映射到实体；文件移动时可更新路径关联并保留实体 ID 与历史。
- 版本行只保存版本元数据，不保存文件字节。部分唯一索引保证每个实体最多有一个当前版本。
- 分支图快照和待解决合并状态以 JSON 存储。服务只暴露类型化操作，不开放任意 SQL。
- SQLite JSON 列在读取和写入时均受限，数据库格式不变：父版本列表 256 KiB；快照 8 MiB、状态项 50,000 条、指纹 50,000 条；分支 JSON 16 MiB、累计版本 50,000 条、累计堆栈点 100,000 个；待解决合并 JSON 2 MiB。`list(entityId)` 最多 50,000 行，且所有 entity/version ID、父版本 JSON、标题、时间、content type、thumbnail path 的 UTF-8 文本总量最多 64 MiB。SQL 会先聚合检查行数和总字节数，再读取明细；任一超限均以诊断错误拒绝。读取 SQL 也会避免把单个超限 JSON 值传入 JavaScript 解码。
- 生产 JSON 编解码器与 list 数量守卫由 `node scripts/verify/version-info-json-budgets.mjs` 验证；此验证不覆盖任意 SQLite 文件损坏或 Lore 引擎。
- 这是全新产品的数据存储，不从其他产品或旧版独立数据库导入数据。

## 服务契约

- `getOrCreateEntity(path)` 返回 `{ entityId, pathKey, path }`。
- `getEntityByPath(path)` 返回匹配实体或 `null`。
- `rebindPath(oldPath, newPath)` 在移动/重命名后保留实体 ID；旧路径没有版本实体时返回 `undefined`；目标路径已绑定到其他历史实体时拒绝合并。
- `list(entityId)`、`save(record)` 和 `setCurrent(entityId, versionId)` 管理类型化版本元数据。
- `graph(entityId)`、`putGraph(entityId, graph)` 管理类型化分支图与待解决合并快照。

## 事件、IPC、MCP、设置

无。本插件由 `data-ops-versions` 通过 Cordis 服务注入使用。

## 持久化读取快照（迁移 2）
新增 version_snapshots 表。entities() 列出已有实体；snapshot(entityId)/putSnapshot(entityId,snapshot) 管理类型化快照：state、各历史版本 SHA-256 fingerprints、synchronizedAt、operation、error。state 包含源文件元数据和中断恢复诊断。提供服务本身不依赖、不调用 Lore。旧数据库原有实体、条目和分支图保持不变；缺少读取快照时默认为 unknown，显式同步后补齐。消费插件用一个 catalog 事务提交完整的条目/分支图/读取快照。
