# PORTS — data-provider-resources

- 域/子类/名称：`data` / `provider` / `resources`；入口 `index.ts`。
- 注入 `ipc`、`store`、`mcp`；通过 `ctx.reflect.provide` 提供 `resources` 服务，类型声明在 `types.ts`。其他主进程插件只能注入服务，不得 import 本插件文件。
- Store 文档 `resource-links` 只保存 `{id,path,name,extension,registeredAt}`。引用原文件，不复制、转码、修改或删除文件；规范化路径去重、并发重复登记返回同一 ID。接受本地盘、映射盘及普通 Windows UNC 共享中的普通文件；映射盘/UNC 别名在 realpath 后复用同一身份。未知格式 MIME 为 `application/octet-stream`；拒绝设备、备用数据流、相对路径和无效共享路径。共享访问沿用操作系统权限，不增加网络监听或写入能力；离线共享按普通失联源文件处理。
- 永久引用 `uri`：`desksuite-resource://local/<uuid>/content.<扩展名>`；无扩展名时为 `content`。运行时 `url` 带 `?v=<revision>`。文档保存 URI/ID，加载前重新 resolve。版本由文件身份、大小、修改/变更时间生成，用于缓存失效，不是内容哈希；MIME 与 kind 是扩展名提示，不保证格式/编码可播放。
- `ResourceInfo`：登记字段 + `uri,url,mimeType,kind,available,size,modifiedAt,revision`。缺失/无权读取/路径被重定向时保留登记但 `available:false`。resolve/list 按需刷新元数据；自动 watcher 与重新定位后续实施。
- 主进程注入服务及 IPC `resources`：`register(path)`、`resolve(reference)`、`list()`、`forget(reference)`、`read(reference,offset?,length?)`、`readText(reference)`。reference 支持 ID、永久 URI、版本链接。read 返回 `{id,revision,offset,total,base64,eof}`，单次最多 1 MiB；readText 只读文本/Markdown，UTF-8，最多 1 MiB。
- 额外 IPC：`choose()` 原生多文件选择；`complete(requestId,{value?,error?})` 为渲染层 MCP 回执。
- 使用 Electron 自定义协议，插件 eager 求值时在 ready 前注册 standard/secure/fetch/CORS/stream，apply 安装处理器，卸载回收。不新增网络监听、不绕过 CSP。渲染 CSP 仅给图片/媒体/连接开放该协议，不给脚本或 frame。当前只服务默认 Electron session。
- 传输：GET/HEAD/OPTIONS，单段 Range（含开放/后缀范围）、206/416、ETag/304、If-Range、流式读取、取消后关闭句柄、no-store。过期版本链接返回 409，永久链接读最新文件。严格按已登记 ID 查源文件，非法链接无法任意读取路径。响应 nosniff + sandbox CSP；CORS 只允许应用文件源或开发渲染源。
- forget 取消登记及后续访问，不删除原文件；已经打开的流可以结束。统一链接不等于文件打包，移动/删除源文件会失效；统一字节入口不等于任意格式已经有预览器。
- 只读 MCP：`resource_list`、`resource_resolve({reference})`、`resource_read({reference,offset?,length?})`、`resource_read_text({reference})`。
- 写入 MCP：`resource_register({path})`、`resource_forget({reference})`，沿用应用 MCP 权限与审计。
- MCP `resource_view({action,reference?,time?,url?,method?,range?,etag?,ifRange?})`：open/preview/inspect/play/pause/seek/fetch/leafer，委托资源面板执行。因可操作播放/界面，标记写入。fetch 经渲染 fetch 读取本协议最多 1 MiB；leafer 验证图片租约加载和释放。回执超时 20 秒；功能验收不使用 CDP 修改状态。
- 广播：`resources:changed` `{id,action:'register'|'forget'}`；`resources:action` 含 requestId 的界面命令。只读取环境变量 ELECTRON_RENDERER_URL 确定开发 CORS 源；无新增用户配置项。
- 已确认功能范围见 `docs/research/LEAFER_BOARD_SCOPE.md`，实机验证入口为 `scripts/verify/resources.mjs`。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
