# canvas-ops-resource-input

- 元数据：canvas / ops / resource-input，入口 index.ts；注入 resources/ipc/mcp，无服务提供、广播、配置。
- IPC canvasInput.clipboardImage 与变更 MCP canvas_paste_image 返回当前系统剪贴板图片的 ResourceInfo；只登记链接，画布插入由渲染 pasteImage 命令完成。
- 空/非图片剪贴板拒绝；PNG 最大 32 MiB。剪贴板没有原文件，因此在 userData/data/canvas-paste 生成 SHA256 命名的不可变 PNG，独占创建并去重，重启保留，不引用会轮换过期的剪贴板历史槽位。
- 原文件不复制、不覆盖，只通过注入 resources.register 协作，不跨插件导入、不新增监听或修改宿主。
