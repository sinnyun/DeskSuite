#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const invoke = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result?.isError, `${name}: ${mcpText(result)}`)
  try { return JSON.parse(mcpText(result)) } catch { return mcpText(result) }
}
const waitFor = async (probe) => {
  const until = Date.now() + 15000
  while (Date.now() < until) { if (await probe()) return; await new Promise((resolve) => setTimeout(resolve, 200)) }
  throw new Error('UI did not update')
}
const shot = async (name) => {
  await invoke('control_window', { action: 'focus' })
  await new Promise((resolve) => setTimeout(resolve, 500))
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data)
  await writeFile(join(outDir, `${name}.png`), Buffer.from(image.data, 'base64'))
}
const cli = process.env.VECTORCRAFT_CLI_PATH || 'C:\\Program Files\\VectorCraft\\vectorcraft-cli.exe'
await invoke('workcrate_vectorcraft_config_set', { config: { cliExecutable: cli, guiExecutable: '', port: 17986 }, confirm: true })
const directory = join(outDir, 'samples', `QuickCreate-${Date.now()}`)
await mkdir(directory, { recursive: true })
const project = await invoke('workcrate_project_create', { name: `快速创建验收-${Date.now()}`, directory, confirm: true })
const projectId = project.project.id
const text = '页面名称\t物料类别\t物料名称\t尺寸标签\t尺寸\t数量\t工艺\r\n签到处\t舞台区\tKT板\t成品\t40×30cm\t20套\t覆膜\r\n\t\t\t\t\t\t\r\n指示牌\t引导区\t亚克力\t成品\t20×30cm\t3块\t雕刻\r\n背景板\t舞台区\t喷绘\t成品\t4×3m\t1张\t打孔'
const table = await invoke('workcrate_quick_create_preview', { text })
assert.equal(table.rows.length, 3)
assert.equal(table.columns.length, 7)
const noHeader = await invoke('workcrate_quick_create_preview', { text: '测试\t区域\t纸板\t成品\t20cm\t10' })
assert.equal(noHeader.rows.length, 1)
const csv = await invoke('workcrate_quick_create_preview', { text: '页面名称,物料名称,备注\n"A,B",纸板,"多行\n备注"' })
assert.equal(csv.rows[0][0], 'A,B')
assert.equal(csv.rows[0][2], '多行\n备注')
for (const invalid of ['物料名称\t物料名称\nA\tB', '页面名称\t数量\nA\t1\t多余', '"未闭合', '\n\t\n']) {
  assert.ok((await mcpCall('workcrate_quick_create_preview', { text: invalid })).isError)
}
const cdp = await connectCdp()
let desktopPid
try {
  await invoke('workcrate_quick_create_open', { projectId, text })
  await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-quick-row]').length === 3`))
  const geometry = await cdp.evaluate(`(() => { const p=document.querySelector('[data-workcrate-view]'); const q=document.querySelector('[data-quick-create]'); const r=q.getBoundingClientRect(); const pr=p.getBoundingClientRect(); return {text:q.innerText, inputs:q.querySelectorAll('tbody input').length, fits:r.bottom<=pr.bottom&&r.right<=pr.right} })()`)
  assert.ok(geometry.fits)
  assert.equal(geometry.inputs, 21)
  assert.match(geometry.text, /3 行物料 → 3 张画布/)
  await shot('workcrate-quick-create-table')
  if (process.argv.includes('--live')) {
    const opened = await invoke('workcrate_document_open', { projectId, confirm: true })
    desktopPid = opened.pid
    // Desktop startup opens the document asynchronously after the launch reply.
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  const result = await invoke('workcrate_boards_quick_create', { projectId, table, confirm: true })
  assert.equal(result.count, 3)
  assert.equal(result.reusedInitial, true)
  assert.equal(result.boards.length, 3, 'must reuse initial blank board')
  assert.equal(result.boards[0].id, project.boards[0].id)
  assert.deepEqual(result.boards.map((board) => board.title), ['签到处', '指示牌', '背景板'])
  assert.equal(result.boards[0].info.quantity, '20套', 'quantity must not multiply boards')
  assert.equal(result.boards[0].info.extra.工艺, '覆膜')
  const refreshed = await invoke('workcrate_boards_refresh', { projectId })
  assert.deepEqual(refreshed.map((board) => board.info), result.boards.map((board) => board.info), 'native material metadata round trip')
  const beforeFailure = await readFile(project.path)
  const failed = await mcpCall('workcrate_boards_quick_create', { projectId, table: { columns: ['物料类别'], rows: [['短内容'], ['超长物料类别'.repeat(50)]] }, confirm: true })
  assert.ok(failed.isError, 'native layout overflow must fail batch')
  assert.match(mcpText(failed), /第 2 行/)
  assert.deepEqual(await readFile(project.path), beforeFailure, 'failed batch must not save partial output')
  assert.equal((await invoke('workcrate_boards_refresh', { projectId })).length, 3)
  const appended = await invoke('workcrate_boards_quick_create', { projectId, table: noHeader, confirm: true })
  assert.equal(appended.reusedInitial, false)
  assert.equal(appended.boards.length, 4)
  assert.deepEqual(appended.boards.slice(0, 3).map((board) => board.info), refreshed.map((board) => board.info))
  const tooMany = await mcpCall('workcrate_boards_quick_create', { projectId, table: { columns: ['页面名称'], rows: Array.from({ length: 201 }, () => ['测试']) }, confirm: true })
  assert.ok(tooMany.isError)
  await invoke('workcrate_panel_open', { projectId })
  await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-page-id]').length === 4`))
  await shot('workcrate-quick-create-pages')
  await invoke('workcrate_panel_open', { projectId, boardId: result.boards[0].id })
  await waitFor(() => cdp.evaluate(`document.querySelector('[data-workcrate-view]')?.dataset.workcrateView === 'page'`))
  await shot('workcrate-quick-create-material')
  const report = { projectId, directory, live: process.argv.includes('--live'), parser: 'TSV/CSV/quoted multiline/blank rows/errors', count: 3, reusedInitial: true, appendedCount: 4, nativeRoundTrip: true, failureLeavesDiskUnchanged: true, geometry }
  await writeFile(join(outDir, 'workcrate-quick-create.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { cdp.close(); if (desktopPid) { try { process.kill(desktopPid) } catch { /* already closed */ } } }
