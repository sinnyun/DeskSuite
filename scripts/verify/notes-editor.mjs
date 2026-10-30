import assert from 'node:assert/strict'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = []

const root = join(projectRoot, 'artifacts/verify/samples/notes-autosave')
const rich = join(root, '富文本样例.md')
const plain = join(root, '纯文本样例.md')
const created = join(root, '验收新建.md')
const interruptedNew = join(root, '不可覆盖草稿.md')
const asset = join(root, 'assets/pic.png')
// 1x1 透明 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const call = async (args) => {
  const result = await mcpCall('note_panel', args)
  assert.ok(!result.isError, mcpText(result))
  return JSON.parse(mcpText(result))
}
const query = async (args) => {
  const result = await mcpCall('note_query', args)
  assert.ok(!result.isError, mcpText(result))
  return JSON.parse(mcpText(result))
}
const wait = async (expression, label = expression) => {
  for (let i = 0; i < 120; i++) {
    if (await cdp.evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`DOM timeout: ${label}`)
}
// 编辑事件到 React 状态之间有一帧延迟，按 MCP 状态轮询而不是猜时间
const waitDirty = async (expected) => {
  for (let i = 0; i < 80; i++) {
    const state = await call({ action: 'inspect' })
    if (state.dirty === expected) return state
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`面板脏状态未在 8 秒内变为 ${expected}`)
}
// 渲染进程重载期间桥接不可用，MCP 会以错误返回；这里容忍失败直到状态符合预期
const waitInspect = async (predicate, label) => {
  let last = null
  for (let i = 0; i < 40; i++) {
    const result = await mcpCall('note_panel', { action: 'inspect' })
    last = result.isError ? null : JSON.parse(mcpText(result))
    if (last && predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`等待超时：${label}（最后状态 ${JSON.stringify(last)}）`)
}
const waitAutoSaved = async (label) => waitInspect((state) => state.dirty === false && state.autoSaveStatus === 'saved' && state.pendingExecution === false, label)
const waitEditableDuringAutoSave = async () => {
  for (let i = 0; i < 100; i++) {
    const state = await call({ action: 'inspect' })
    if (state.autoSaveStatus === 'saving') {
      return await cdp.evaluate('document.querySelector("[data-note-editor-wysiwyg] .ProseMirror")?.getAttribute("contenteditable") === "true"')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('未观察到自动保存状态，无法检查编辑器是否保持可编辑')
}
const front = '---\nid: fixture-1\ntitle: "富文本样例"\ncategory: notes\nstatus: draft\ntags: ["验收", "编辑器"]\n---\n\n'
const imageSelector = 'Boolean(document.querySelector("[data-note-editor] .milkdown img[src^=\'desksuite-resource:\']"))'

try {
  // 上一轮中断可能留下未保存改动；先把它们落盘清理，再覆盖样本文件，保证幂等
  const probe = await call({ action: 'inspect' })
  if (probe.dirty) {
    await waitAutoSaved('上一轮遗留改动自动保存')
    report.push(`自动保存上一轮遗留改动：${probe.activePath}`)
  }
  await mkdir(join(root, 'assets'), { recursive: true })
  await rm(created, { force: true })
  await rm(interruptedNew, { force: true })
  await writeFile(asset, png)
  await writeFile(rich, `${front}# 富文本样例\n\n正文第一段。\n`)
  await writeFile(plain, '---\ntags: []\n---\n\n# 纯文本样例\n')

  await call({ action: 'setroot', path: root })
  await wait('Boolean(document.querySelector("[data-note-editor] .milkdown div.ProseMirror"))', 'Crepe 首次挂载')
  const mounted = await call({ action: 'inspect' })
  assert.equal(mounted.root, root)
  assert.equal(mounted.fileCount, 2)
  assert.equal(mounted.editorMounted, true, 'Crepe 编辑器未挂载')
  await call({ action: 'select', title: '富文本样例' })
  await wait('document.querySelector("[data-note-editor] .milkdown div.ProseMirror h1")?.innerText === \'富文本样例\'', 'Crepe 重新挂载并渲染标题')
  const opened = await call({ action: 'inspect' })
  assert.equal(opened.activePath.replace(/[\\/]/g, '\\'), rich.replace(/[\\/]/g, '\\'))
  report.push(`目录内列出 ${mounted.fileCount} 篇；选中后加载 ${opened.activePath}，正文 ${opened.bodyLength} 字`)

  await wait('Boolean(document.querySelector("[data-note-editor] .milkdown div.ProseMirror[contenteditable]"))', 'Crepe 可编辑区域')
  const structure = await cdp.evaluate(`(() => {
    const doc = document.querySelector('[data-note-editor] .milkdown');
    const pm = doc.querySelector('div.ProseMirror');
    return {
      topbar: Boolean(doc.querySelector('.milkdown-top-bar')),
      topBarDisplay: doc.querySelector('.milkdown-top-bar') ? getComputedStyle(doc.querySelector('.milkdown-top-bar')).display : '',
      headingLabel: doc.querySelector('.top-bar-heading-label')?.innerText ?? '',
      blockHandle: Boolean(doc.querySelector('.milkdown-block-handle')),
      slashMenu: Boolean(doc.querySelector('.milkdown-slash-menu')),
      selectionToolbar: Boolean(doc.querySelector('.milkdown-toolbar')),
      h1: pm.querySelector('h1')?.innerText ?? '',
      editable: pm.getAttribute('contenteditable')
    }
  })()`)
  assert.equal(structure.h1, '富文本样例')
  assert.equal(structure.editable, 'true')
  assert.equal(structure.topbar, false, '编辑器不应常驻占位的 TopBar')
  // 斜杠菜单与拖拽手柄由 hover/选区触发，MCP 无法安全派发指针事件，只记录挂载状态不断言
  report.push({ structure })

  // 图片：旧相对引用经统一 resources 服务解析为永久 URI 预览，正文仍保留原相对引用
  const editorHandle = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[data-note-editor] .ProseMirror")', returnByValue: false })
  assert.ok(editorHandle.result.objectId, '编辑器 DOM 句柄缺失')
  await call({ action: 'setbody', markdown: '# 图片与表格\n\n![示例](assets/pic.png)\n\n| 名称 | 值 |\n| --- | --- |\n| 甲 | 1 |\n| 乙 | 2 |\n\n```ts\nconst a = 1\n```\n\n- 项目一\n- 项目二\n' })
  await wait(imageSelector, '相对图片解析为 data: 预览')
  // 作用域限定在同一个 ProseMirror 实例上，避免 CodeMirror 动态挂载的中间态被误判
  await wait(`(() => { const pm = document.querySelector("[data-note-editor] .milkdown div.ProseMirror"); const code = pm && (pm.querySelector(".cm-content") ?? pm.querySelector("pre")); return Boolean(code && code.textContent.includes("const a = 1")) })()`, '代码块内容渲染')
  const rendered = await cdp.evaluate(`(() => {
    const pm = document.querySelector('[data-note-editor] .milkdown div.ProseMirror');
    const img = pm.querySelector('img');
    return {
      heading: pm.querySelector('h1')?.innerText ?? '',
      rows: pm.querySelectorAll('table tr').length,
      code: ((pm.querySelector('.cm-content') ?? pm.querySelector('pre'))?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      codeBlock: Boolean(pm.querySelector('.milkdown-code-block')),
      bullets: pm.querySelectorAll('ul li').length,
      imgDomSrcPrefix: (img?.getAttribute('src') ?? '').slice(0, 5),
      imgPreviewPrefix: (img?.currentSrc || img?.src || '').slice(0, 5)
    }
  })()`)
  const evidence = JSON.stringify(rendered)
  assert.equal(rendered.heading, '图片与表格', `标题不符：${evidence}`)
  assert.equal(rendered.rows, 3, `表格行数不符：${evidence}`)
  assert.equal(rendered.bullets, 2, `列表项数不符：${evidence}`)
  assert.ok(rendered.code.includes('const a = 1'), `代码块未由 CodeMirror 渲染：${evidence}`)
  assert.ok(rendered.codeBlock, `代码块容器缺失：${evidence}`)
  assert.equal(rendered.imgPreviewPrefix, 'desks', `图片预览地址不符：${evidence}`)
  report.push({ rendered })
  const outline = await query({ action: 'outline' })
  assert.ok(outline.headings.some((heading) => heading.title === '图片与表格'))
  assert.ok(outline.chars > 0 && outline.words > 0)
  const search = await query({ action: 'search', title: '正文第一段' })
  assert.ok(search.some((item) => item.path === rich), `正文全文搜索未命中富文本样例：${JSON.stringify(search)}`)
  report.push({ outline, fullTextHits: search.length })

  const beforeSave = await waitInspect((state) => String(state.contentSample ?? '').includes('assets/pic.png') && String(state.editorMarkdown ?? '').includes('assets/pic.png'), '面板状态追上编辑器正文')
  assert.ok(beforeSave.editorMarkdown.includes('assets/pic.png'), '序列化 Markdown 应保留相对图片引用')
  assert.ok(!beforeSave.editorMarkdown.includes('data:image'), '预览地址不得进入 Markdown 真源')
  const saved = await waitAutoSaved('现有笔记防抖自动保存完成')
  const retainedEditor = await cdp.send('Runtime.callFunctionOn', {
    objectId: editorHandle.result.objectId,
    functionDeclaration: 'function () { return this.isConnected && this === document.querySelector("[data-note-editor] .ProseMirror") }',
    returnByValue: true
  })
  assert.equal(retainedEditor.result.value, true, '编辑和自动保存不得重建编辑器 DOM，避免丢失光标与撤销历史')
  await cdp.send('Runtime.releaseObject', { objectId: editorHandle.result.objectId })
  report.push('正文编辑及自动保存前后保持同一个 ProseMirror DOM 实例')
  assert.equal(saved.activePath.replace(/[\\/]/g, '\\'), rich.replace(/[\\/]/g, '\\'))
  const onDisk = await readFile(rich, 'utf8')
  assert.ok(onDisk.startsWith('---\nid: fixture-1'), 'frontmatter 未原样保留')
  assert.ok(onDisk.includes('tags: ["验收", "编辑器"]'), 'frontmatter 标签丢失')
  assert.ok(onDisk.includes('# 图片与表格') && onDisk.includes('assets/pic.png'), '正文未按 Markdown 写回')
  assert.ok(!onDisk.includes('data:image'), '图片预览地址被写进了文件')
  report.push('正文变化经防抖自动保存，frontmatter 原样保留，旧相对图片链接仍原样保存，显示使用统一资源 URI')

  assert.equal((await waitDirty(false)).activePath.replace(/[\\/]/g, '\\'), rich.replace(/[\\/]/g, '\\'))
  const selected = await call({ action: 'select', title: '纯文本样例' })
  assert.ok(String(selected.activePath).endsWith('纯文本样例.md'))
  await wait('document.querySelector("[data-note-editor] .milkdown div.ProseMirror h1")?.innerText === \'纯文本样例\'', '切换笔记后重新挂载')
  report.push('切换笔记重挂载编辑器，标题与列表状态同步')

  await call({ action: 'select', title: '富文本样例' })
  await wait('document.querySelector("[data-note-editor] .milkdown div.ProseMirror h1")?.innerText === \'图片与表格\'', '回看已保存笔记')
  await mcpCall('control_window', { action: 'focus' })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const shot = mcpImage(await mcpCall('capture_window'))
  await writeFile(join(outDir, 'note-editor.png'), Buffer.from(shot.data, 'base64'))

  await wait("(() => { const el = document.querySelector('[data-note-editor] .milkdown'); return el ? getComputedStyle(el).getPropertyValue('--crepe-color-background').trim() !== '' : false })()", 'Crepe 主题变量可读')
  // CDP 只读：主题切换不属于笔记保存回归，仅读取当前主题变量。
  const theme = await cdp.evaluate(`getComputedStyle(document.querySelector('[data-note-editor] .milkdown')).getPropertyValue('--crepe-color-background').trim()`)
  assert.ok(['#1a1a1a', '#ffffff'].includes(theme))
  report.push({ theme })

  // 新建：MCP 的 new 动作与面板内联输入走同一条路径（Electron 不支持 window.prompt）
  await call({ action: 'new', title: '验收新建' })
  await wait('document.querySelector("[data-note-editor] .milkdown div.ProseMirror h1")?.innerText === \'验收新建\'', '新建笔记进入编辑器')
  const drafted = await call({ action: 'inspect' })
  assert.ok(String(drafted.activePath).endsWith('验收新建.md'), `新建后的活动路径不符：${JSON.stringify(drafted)}`)
  assert.equal(drafted.dirty, true, '新建笔记应等待防抖自动保存')
  await call({ action: 'setbody', markdown: '# 验收新建\n\n由 MCP 新建并保存。\n' })
  const draftedBody = await waitInspect((state) => String(state.contentSample ?? '').includes('由 MCP 新建并保存'), '新建正文已进入面板状态')
  assert.equal(draftedBody.dirty, true, '正文刚修改时应处于自动保存等待状态')
  const completed = await waitAutoSaved('新建笔记及正文自动保存')
  assert.equal(completed.pendingExecution, false)
  assert.equal(completed.fileCount, 3, '新建保存后应立即进入列表')
  await call({ action: 'select', title: '验收新建' })
  const createdOnDisk = await readFile(created, 'utf8')
  assert.ok(/^---\nid: [0-9a-f-]{36}\r?\ntitle: "验收新建"/.test(createdOnDisk), `新建笔记 frontmatter 不符：${createdOnDisk.slice(0, 80)}`)
  assert.ok(createdOnDisk.includes('由 MCP 新建并保存。'), '新建笔记正文未写入磁盘')
  report.push(`新建 → 编辑 → 防抖自动保存落盘：${created}`)

  await call({ action: 'setattrs', attributes: { tags: ['验收', 'MCP'] } })
  await waitAutoSaved('frontmatter 属性自动保存')
  assert.ok((await readFile(created, 'utf8')).includes('tags:') && (await readFile(created, 'utf8')).includes('MCP'), 'MCP 属性编辑未保存标签')
  const beforeUiOnly = (await stat(created)).mtimeMs
  await call({ action: 'sourceMode', enabled: true })
  await wait('Boolean(document.querySelector("[data-note-editor-source]"))', '源码模式切换')
  await call({ action: 'sourceMode', enabled: false })
  await wait('Boolean(document.querySelector("[data-note-editor-wysiwyg] .milkdown"))', '所见即所得模式切换')
  await call({ action: 'readingMode', enabled: true })
  await call({ action: 'readingMode', enabled: false })
  await new Promise((resolve) => setTimeout(resolve, 900))
  const afterUiOnly = (await stat(created)).mtimeMs
  assert.equal(afterUiOnly, beforeUiOnly, '源码/阅读模式等界面状态不得触发文档写入')
  report.push('源码/所见即所得和阅读模式切换不修改笔记文件时间戳')
  await call({ action: 'findReplace', operation: 'replaceAll', query: '由 MCP', replacement: '通过 MCP' })
  await waitInspect((state) => String(state.contentSample ?? '').includes('通过 MCP 新建并保存'), '查找替换结果进入笔记状态')
  await waitAutoSaved('查找替换自动保存')
  assert.ok((await readFile(created, 'utf8')).includes('通过 MCP 新建并保存。'), 'MCP 查找替换没有写回正文')

  await call({ action: 'readingMode', enabled: true })
  await wait('document.querySelector("[data-note-editor-wysiwyg] .ProseMirror")?.getAttribute("contenteditable") === "false"', 'MCP 阅读模式设为只读')
  await call({ action: 'readingMode', enabled: false })
  await wait('document.querySelector("[data-note-editor-wysiwyg] .ProseMirror")?.getAttribute("contenteditable") === "true"', 'MCP 退出阅读模式')
  await call({ action: 'createVersion', title: '笔记专项验收快照' })
  const versions = await query({ action: 'versions', path: created })
  assert.ok(versions.length > 0, 'MCP Lore 版本查询未返回快照')
  report.push({ mcpActions: ['setattrs', 'findReplace', 'sourceMode', 'readingMode', 'createVersion', 'versions'], versions: versions.length })

  // 未保存的修改经过防抖落盘后，重载必须读回磁盘中的最新内容。
  await call({ action: 'select', title: '富文本样例' })
  await wait('document.querySelector("[data-note-editor] .milkdown div.ProseMirror h1")?.innerText === \'图片与表格\'', '重载前回到富文本样例')
  await call({ action: 'setbody', markdown: '# 自动保存后重载\n\n这段内容必须已经写入 Markdown 文件。\n' })
  assert.equal(await waitEditableDuringAutoSave(), true, '自动保存期间编辑器必须保持可编辑')
  await waitInspect((state) => String(state.contentSample ?? '').includes('必须已经写入'), '自动保存正文进入编辑器状态')
  await waitAutoSaved('重载前自动保存完成')
  assert.ok((await readFile(rich, 'utf8')).includes('这段内容必须已经写入 Markdown 文件。'), '自动保存未写入磁盘')
  await cdp.send('Page.enable')
  await cdp.send('Page.reload')
  const restored = await waitInspect(
    (state) => state.root === root && /富文本样例\.md$/.test(String(state.activePath)) && state.dirty === false && String(state.contentSample ?? '').includes('必须已经写入'),
    '重载后读回自动保存内容'
  )
  assert.equal(restored.editorMounted, true, '重载后编辑器未自动挂载')
  assert.ok(String(restored.contentSample).includes('自动保存后重载'), '重载后未读回最新文档内容')
  report.push(`文档防抖自动保存后重载读回最新磁盘正文：${restored.activePath}`)
  await call({ action: 'open' })
  await mcpCall('control_window', { action: 'focus' })
  await new Promise((resolve) => setTimeout(resolve, 600))
  const restoredShot = mcpImage(await mcpCall('capture_window'))
  await writeFile(join(outDir, 'note-editor-restored.png'), Buffer.from(restoredShot.data, 'base64'))

  console.log(JSON.stringify({ ok: true, report }, null, 2))
  await writeFile(join(outDir, 'note-editor.json'), JSON.stringify({ ok: true, report }, null, 2))
} finally {
  cdp.close()
}
