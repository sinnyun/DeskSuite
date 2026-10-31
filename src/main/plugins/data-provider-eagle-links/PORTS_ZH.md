# data-provider-eagle-links

- 元数据：data / provider / eagle-links，入口 index.ts；对象式 Cordis 插件，inject resources/store/ipc/mcp；通过声明合并提供 eagleLinks 服务。无网络监听、原图复制、缩略图生成或 Eagle 内容修改。
- 参考 F:/AI/geren/pho_cordis 的 fileatlas-plugin-eagle-links。固定访问本机 41595 端口：V2 item/get、folder/get 与 V1 item/thumbnail；单次超时 5 秒、JSON 上限 4MiB、拒绝重定向。需要 Eagle 正在运行且支持 V2（4.0 Build21+），不读取/保存/记录 API token。
- 确认原图：条目 ID 仅允许字母数字；拒绝回收站/缺失/多结果；缩略图必须属于 <id>.info 目录。noThumbnail 条目使用接口返回文件自身；其他条目在同目录排除缩略图后，以扩展名和字节大小确认唯一普通文件。拖入路径必须与原图规范路径一致；不把缩略图冒充原图。该同目录布局为已观察约定，并非公开稳定原图接口。
- 原文件登记/解析只经统一 resources 服务。版本化 Store eagle-source-links v1 按稳定 resourceUri 持久化来源快照（ID、名称、原图路径、缩略图路径、API 地址、文件夹、标签、备注、来源网址、尺寸、大小、评分、更新时间）；整体 JSON 最多 256 MiB、5 万条，串行写入并由 Store 启动校验；不存图片字节。场景无需增加 Eagle 字段，节点资源链接关联快照。
- IPC/服务 eagleLinks：link({itemId? 或 location?}) 返回来源；get(reference) 获取缓存或 null，不依赖 Eagle 在线；inspect(reference,refresh=false) 自动识别 .info 原图、确认并持久化来源，普通文件返回 null；open(itemId) 经 shell.openExternal 发送固定 eagle://item/{id}。系统成功派发不等同于外部 Eagle 已完成选中。
- MCP：eagle_link、eagle_source、eagle_open_item；走原有权限和审计。保存后广播 eagleLinks:changed {reference}；不新增配置、不开放任意命令/API 地址。Eagle API envelope `message` 最多 2,000 字符；provider 共享服务抛出的错误在交给消费者前经主进程共享 formatter 限长到 2,000 字符，并遮蔽凭据和本机路径。失败明确报错；刷新会核对当前资源库及原图路径。无自动轮询和元数据删除。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
