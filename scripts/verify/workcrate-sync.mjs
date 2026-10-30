#!/usr/bin/env node
// DeskSuite mutations use its MCP; external-editor fixtures use VectorCraft's MCP.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cli = process.env.VECTORCRAFT_CLI_PATH || 'C:\\Program Files\\VectorCraft\\vectorcraft-cli.exe'
const directory = join(outDir, 'samples', `WorkCrateSync-${Date.now()}`)
await mkdir(directory, { recursive: true })
const port = 17983
const invoke = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result?.isError, `${name}: ${mcpText(result)}`)
  try { return JSON.parse(mcpText(result)) } catch { return mcpText(result) }
}
const waitFor = async (probe, message) => {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (await probe()) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(message)
}
async function nativeSession(connect = false) {
  const child = spawn(cli, ['mcp', ...(connect ? ['--connect', `127.0.0.1:${port}`] : ['--headless', '--automation-read-root', directory, '--automation-write-root', directory])], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, VECTORCRAFT_CONFIG_DIR: join(directory, 'fixture-cli') } })
  const pending = new Map()
  let id = 0
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const reply = JSON.parse(line)
    const entry = pending.get(reply.id)
    if (!entry) return
    pending.delete(reply.id); clearTimeout(entry.timer)
    if (reply.error) entry.reject(new Error(JSON.stringify(reply.error)))
    else entry.resolve(reply.result)
  })
  child.on('error', (error) => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }; pending.clear() })
  const request = (method, params) => new Promise((resolve, reject) => {
    const current = ++id
    const timer = setTimeout(() => { pending.delete(current); reject(new Error(`Native timeout: ${method}`)) }, 15000)
    pending.set(current, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: current, method, params })}\n`)
  })
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'WorkCrate verification fixture', version: '1' } })
  const tool = async (name, args = {}) => {
    const result = await request('tools/call', { name, arguments: args })
    assert.ok(!result.isError, mcpText(result))
    return JSON.parse(mcpText(result))
  }
  return { tool, command: (id, params = {}) => tool('command_run', { id, params }), close: () => { lines.close(); child.kill() } }
}
await invoke('workcrate_vectorcraft_config_set', { config: { cliExecutable: cli, guiExecutable: join(dirname(cli), 'vectorcraft.exe'), port }, confirm: true })
const created = await invoke('workcrate_project_create', { name: `同步与排序验收-${Date.now()}`, directory, confirm: true })
const projectId = created.project.id
const catalog = () => invoke('workcrate_board_catalog', { projectId })
const cdp = await connectCdp()
let desktopPid
const state = () => cdp.evaluate(`(() => { const panel = document.querySelector('[data-workcrate-view]'); return {view:panel?.dataset.workcrateView, active:panel?.dataset.activeBoard, text:panel?.innerText, values:[...panel?.querySelectorAll('input') ?? []].map(input=>input.value), draggable:panel?.querySelectorAll('[draggable=true]').length, previews:[...panel?.querySelectorAll('img') ?? []].every(img=>img.complete&&img.naturalWidth>0)} })()`)
const shot = async (name) => {
  await invoke('control_window', { action: 'focus' })
  await new Promise((resolve) => setTimeout(resolve, 400))
  const result = await mcpCall('capture_window')
  const image = mcpImage(result)
  assert.ok(image?.data)
  await writeFile(join(outDir, `${name}.png`), Buffer.from(image.data, 'base64'))
}
try {
  await invoke('workcrate_panel_open')
  await waitFor(async () => (await state()).view === 'projects', 'project page missing')
  await shot('workcrate-sync-projects')
  await invoke('workcrate_panel_open', { projectId })
  await waitFor(async () => (await state()).view === 'pages', 'page manager missing')
  await shot('workcrate-sync-pages')
  const firstId = created.boards[0].id
  await invoke('workcrate_panel_open', { projectId, boardId: firstId })
  await waitFor(async () => (await state()).view === 'page', 'page editor missing')
  const second = await invoke('workcrate_board_create_page', { projectId, confirm: true })
  await waitFor(async () => (await state()).draggable === 2, 'new board did not reach editor')
  await invoke('workcrate_boards_refresh', { projectId })
  await waitFor(async () => (await state()).previews, 'previews missing')
  assert.equal((await state()).view, 'page', 'manual sync must preserve editor')
  assert.equal((await state()).active, firstId)
  const ordered = [second.id, firstId]
  await invoke('workcrate_boards_reorder', { projectId, boardIds: ordered, confirm: true })
  assert.deepEqual((await catalog()).map((board) => board.id), ordered)
  const invalid = await mcpCall('workcrate_boards_reorder', { projectId, boardIds: [firstId, firstId], confirm: true })
  assert.ok(invalid.isError, 'duplicate board IDs must be rejected')
  const external = await nativeSession()
  try {
    await external.tool('open_file', { path: created.path })
    const inspect = await external.command('document.json')
    assert.equal(String(inspect.artboards[0].id), second.id.split(':').at(-1), 'native file order must match the WorkCrate order')
    await external.command('artboard.setProps', { index: 0, name: '外部保存后自动刷新' })
    await external.tool('save_file', { path: created.path })
  } finally { external.close() }
  await waitFor(async () => (await catalog())[0].title === '外部保存后自动刷新', 'saved external change did not auto-sync')
  await waitFor(async () => (await state()).text.includes('外部保存后自动刷新'), 'editor labels did not refresh')
  assert.equal((await state()).active, firstId)

  const desktop = await invoke('workcrate_document_open', { projectId, confirm: true })
  desktopPid = desktop.launched ? desktop.pid : undefined
  let live
  await waitFor(async () => {
    try { live = await nativeSession(true); await live.tool('doc_inspect', { depth: 0 }); return true } catch { live?.close(); return false }
  }, 'VectorCraft desktop control did not start')
  try {
    await live.command('artboard.setProps', { index: 0, name: 'GUI 未保存修改' })
    await waitFor(async () => (await catalog())[0].title === 'GUI 未保存修改', 'unsaved desktop change did not auto-sync')
    const liveExport = await invoke('workcrate_boards_export', { projectId, directory, boardIds: [second.id], format: 'png', confirm: true })
    assert.equal(liveExport.files.length, 1)
    assert.ok(liveExport.files[0].includes('GUI 未保存修改'), 'export must use the live unsaved artboard instead of the disk copy')
    const third = await invoke('workcrate_board_create_page', { projectId, confirm: true })
    assert.equal((await live.tool('doc_inspect', { depth: 0 })).artboards.length, 3, 'WorkCrate new board must appear live in VectorCraft')
    await invoke('workcrate_board_update_info', { boardId: third.id, info: { material: '双向同步物料' }, confirm: true })
    assert.ok(JSON.stringify(await live.command('document.json')).includes('双向同步物料'), 'material edits must reach live VectorCraft')
    await invoke('workcrate_boards_reorder', { projectId, boardIds: [third.id, firstId, second.id], confirm: true })
    assert.equal(String((await live.command('document.json')).artboards[0].id), third.id.split(':').at(-1))
    await invoke('workcrate_panel_open', { projectId, boardId: third.id })
    await waitFor(async () => (await state()).active === third.id && (await state()).draggable === 3 && (await state()).values.includes('双向同步物料') && (await state()).previews, 'editor did not show new board')
    const ui = await state()
    assert.ok(ui.text.includes('新增画板') && ui.text.includes('拖动调整顺序'))
    assert.ok(ui.text.includes('项目管理') && ui.text.includes('页面管理') && ui.text.includes('页面编辑'))
    assert.equal(ui.view, 'page')
    await live.command('file.close')
    await assert.rejects(() => live.tool('doc_inspect', { depth: 0 }), /no document open/)
    await new Promise((resolve) => setTimeout(resolve, 1800))
    assert.equal(await cdp.evaluate("document.querySelector('[data-workcrate-notifications] [role=alert]')?.textContent ?? ''"), '', 'empty desktop must not cause automatic sync errors')
    await invoke('workcrate_boards_refresh', { projectId })
    await assert.rejects(() => live.tool('doc_inspect', { depth: 0 }), /no document open/, 'read-only sync should leave an empty desktop alone')
    await invoke('workcrate_board_create_page', { projectId, confirm: true })
    assert.equal((await live.tool('doc_inspect', { depth: 0 })).artboards.length, 4, 'write should open the project in an empty desktop')
    await live.command('file.close')
    await invoke('workcrate_document_open', { projectId, confirm: true })
    assert.equal((await live.tool('doc_inspect', { depth: 0 })).artboards.length, 4, 'open should recover an empty desktop')
  } finally { live.close() }
  // Bring DeskSuite out from under the external editor before visual capture.
  if (desktopPid) { process.kill(desktopPid); desktopPid = undefined }
  await shot('workcrate-sync-editor')
  const report = { projectId, document: created.path, passed: ['external-save-auto-refresh', 'manual-sync-preserves-editor', 'tab-labels', 'create-board-in-editor', 'native-board-order', 'invalid-order-rejected', 'unsaved-GUI-to-WorkCrate', 'WorkCrate-to-live-GUI', 'material-to-live-GUI', 'live-unsaved-export', 'empty-desktop-auto-sync', 'empty-desktop-read-sync', 'empty-desktop-write-opens-project', 'empty-desktop-open-recovers'], screenshots: ['workcrate-sync-projects.png', 'workcrate-sync-pages.png', 'workcrate-sync-editor.png'] }
  await writeFile(join(outDir, 'workcrate-sync.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
  if (desktopPid) { try { process.kill(desktopPid) } catch {} }
}
