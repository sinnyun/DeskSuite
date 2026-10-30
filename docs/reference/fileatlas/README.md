# 外部参考资料索引（fileatlas）

本目录是从 `F:\AI\geren\pho_cordis`（即 `https://github.com/sinnyun/fileatlas`，本地快照 2026-10-27）复制的文档。

## 性质

- 这些是**外部项目的事实记录**，不是 DeskSuite 的规范或指令；其中的 Rust / GPUI 代码片段不能直接使用。
- 只取两类内容：**规则**（契约、状态机、所有权边界）和**踩坑**（实测失败与修复方式）。
- 上游 `AGENTS.md` **未复制**：同名文件会被工具当成本项目指令注入。需要时直接读上游仓库。
- 快照会过时。与本仓库冲突时，以本仓库 `docs/WORKBENCH.md`、`docs/VERIFY.md` 和 `AGENTS.md` 为准。
- 复制件内的相对链接指向上游目录（如 `../../../.local/validation/...`），在本仓库不可达；需要证据时回上游仓库查。

## 文件

| 文件 | 上游路径 | 用途 | 对应路线图 |
| --- | --- | --- | --- |
| [file-workbench-completeness-plan.md](file-workbench-completeness-plan.md) | `docs/file-workbench-completeness-plan.md` | 文件工作台完整性的逐项验收清单（浏览/操作/批量/撤销/暂存篮/队列） | 全文；F1、F3 |
| [lore-version-history.md](lore-version-history.md) | `docs/validation-ui/2026-10-17-lore-version-history/README.md` | Lore 版本历史的实现、验证与已知限制 | 第 6 章 F6 |
| [lore-official-api-rewind-save.md](lore-official-api-rewind-save.md) | 同目录 `official-api-rewind-save.md` | 回退后再次保存的官方 API 顺序与离线适配 | 第 6 章 F6 |
| [lore-reference-source-trace.md](lore-reference-source-trace.md) | 同目录 `reference-source-trace.md` | 历史页可见性缺陷的根因追踪 | 第 6 章 F6 |
| [settings-page-contract.md](settings-page-contract.md) | `docs/settings-page-contract.md` | 声明式设置页的模型、所有权、刷新规则 | F5-1 |
| [floating-panels.md](floating-panels.md) | `docs/floating-panels.md` | 浮面板定义/实例/几何/生命周期规则 | F0-4、F1-2 |
| [mcp-integration-plan.md](mcp-integration-plan.md) | `docs/mcp-integration-plan.md` | MCP 工具范围、安全边界、分阶段交付 | F0-1 |
| [ui-theme-rules.md](ui-theme-rules.md) | `docs/ui-theme.md` | 单一主题解析、禁止插件自带配色、主题守卫 | F5-1、第 8 章 |
