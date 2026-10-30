# PORTS — data-provider-resources（渲染层）

- 元数据：data / provider / resources；入口 `index.tsx`；核心提供插件，无槽位。
- 经 SDK 注册渲染服务 `resources`，消费者用 `getService('resources')` 获取，不跨插件 import；元数据对应主进程 IPC，持久数据留在主进程。可选消费者缺失时应降级。
- register/resolve/list/choose/forget/read/readText 调用同名 IPC。
- `registerFile(file: File)` 经现有 resources.register 登记浏览器 File 对应的本地原文件；preload 的通用 invoke 参数适配在 IPC 前通过 Electron webUtils 将 File（含数组成员）转为路径。不读取或复制字节，不新增第二个桥；没有本地文件的内存 File 明确报错，不嵌入像素。这是原生参数边界，不在渲染层访问文件系统。
- `acquireImage(reference)` 解析当前版本，共享进行中的 `Resource.loadImage(url)`，返回 `{leaseId,key,url,resource,width,height}`。key 使用包含扩展名、版本的传输链接，便于 Leafer 识别类型。`releaseImage(leaseId)` 幂等；最后一个自有租约释放时调用 `Resource.remove(key)`。消费者必须先销毁/移除 Leafer 元素再释放租约，不得将已释放图片继续用于元素。本插件从不调用全局 Resource.destroy()。
- `getImageCacheState()` 返回自有缓存与租约数量。此层连接应用永久 URI 与 Leafer 内存资源；不是持久化或转码。源文件改变后重新 resolve，不序列化租约或解码后的图片对象。
- 租约参与 Leafer 图片自身的 use 计数，复用已有资源而不覆盖其他元素的资源对象。外部 Leafer 节点仍在引用时不移除缓存；无引用的失败加载会回收以便重试。
- 无浏览器存储、文件系统访问、事件、配置项、MCP 注册或第二个 preload 桥。
