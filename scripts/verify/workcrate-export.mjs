#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const invoke = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, `${name}: ${mcpText(result)}`)
  try { return JSON.parse(mcpText(result)) } catch { return mcpText(result) }
}
const directory = join(outDir, 'samples', `WorkCrateExport-${Date.now()}`)
await mkdir(directory, { recursive: true })
await invoke('workcrate_vectorcraft_config_set', { config: { cliExecutable: process.env.VECTORCRAFT_CLI_PATH || 'C:\\Program Files\\VectorCraft\\vectorcraft-cli.exe', port: 17985 }, confirm: true })
const project = await invoke('workcrate_project_create', { name: `画板导出验收-${Date.now()}`, directory, confirm: true })
const projectId = project.project.id
await invoke('workcrate_board_create_page', { projectId, confirm: true })
await invoke('workcrate_board_create_page', { projectId, confirm: true })
const boards = await invoke('workcrate_board_catalog', { projectId })
await invoke('workcrate_board_update_info', { boardId: boards[0].id, info: { material: '页面一' }, confirm: true })
const sourceHash = async () => createHash('sha256').update(await readFile(project.path)).digest('hex')
const original = await sourceHash()
const cdp = await connectCdp()
const waitFor = async (expression) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await cdp.evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`UI assertion timed out: ${expression}`)
}
const selection = async (mode, ids, count) => {
  await invoke('workcrate_pages_select', { projectId, mode, boardIds: ids })
  await waitFor(`document.querySelectorAll('[data-page-id][data-selected=true]').length === ${count}`)
}
const exportBoards = (format, boardIds, scale = 1) => invoke('workcrate_boards_export', { projectId, directory, format, boardIds, scale, confirm: true })
try {
  await invoke('workcrate_panel_open', { projectId })
  await waitFor("document.querySelectorAll('[data-page-id]').length === 3")
  await selection('single', [boards[0].id], 1)
  await selection('multiple', [boards[2].id, boards[0].id], 2)
  // Refresh must retain selection by board identity.
  await invoke('workcrate_boards_refresh', { projectId })
  await waitFor("document.querySelectorAll('[data-page-id][data-selected=true]').length === 2")
  const selectedPng = await exportBoards('png', [boards[2].id, boards[0].id], 2)
  assert.equal(selectedPng.files.length, 2)
  assert.ok(basename(selectedPng.files[0]).startsWith('001-'))
  assert.ok(basename(selectedPng.files[1]).startsWith('003-'))
  const png = await readFile(selectedPng.files[0])
  assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
  assert.ok(Math.abs(png.readUInt32BE(16) - boards[0].widthPt * 2) <= 1)
  assert.ok(Math.abs(png.readUInt32BE(20) - boards[0].heightPt * 2) <= 1)
  await selection('all', [], 3)
  const allPng = await exportBoards('png')
  assert.equal(allPng.files.length, 3)
  const allJpg = await exportBoards('jpg')
  assert.equal(allJpg.files.length, 3)
  for (const file of allJpg.files) assert.ok((await readFile(file)).subarray(0, 2).equals(Buffer.from([255, 216])))
  const pdf = await exportBoards('pdf')
  assert.equal(pdf.files.length, 1)
  const pdfBytes = await readFile(pdf.files[0])
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-')
  assert.equal([...pdfBytes.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length, 3, 'native PDF must contain all three artboard pages')
  const repeated = await exportBoards('png', [boards[0].id])
  assert.notEqual(repeated.directory, allPng.directory, 'repeated exports must not overwrite old files')
  for (const args of [{ boardIds: [] }, { boardIds: ['stale-board'] }, { boardIds: [boards[0].id, boards[0].id] }, { directory: outDir }]) {
    const result = await mcpCall('workcrate_boards_export', { projectId, directory, format: 'png', confirm: true, ...args })
    assert.ok(result.isError, 'empty/stale/duplicate selection and unauthorized directory must fail')
  }
  assert.equal(await sourceHash(), original, 'export must not save or replace the native document')
  await selection('clear', [], 0)
  const disabled = await cdp.evaluate("[...document.querySelectorAll('[data-page-manager] button')].find(button=>button.textContent==='导出选中图片')?.disabled")
  assert.equal(disabled, true)
  await selection('multiple', [boards[0].id, boards[2].id], 2)
  const geometry = await cdp.evaluate("(() => {const panel=document.querySelector('[data-page-manager]'); return {width:panel.clientWidth, scrollWidth:panel.scrollWidth, checked:panel.querySelectorAll('input:checked').length} })()")
  assert.equal(geometry.checked, 2)
  assert.ok(geometry.scrollWidth <= geometry.width + 2)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data)
  await writeFile(join(outDir, 'workcrate-page-export.png'), Buffer.from(image.data, 'base64'))
  const report = { projectId, selectedPng, allPng, allJpg, pdf, imageSize2x: [png.readUInt32BE(16), png.readUInt32BE(20)], pdfPages: 3, sourceUnchanged: true, selectionChecks: ['single', 'multiple', 'all', 'clear', 'refresh-preserves-selection'], invalidArgumentsRejected: true, screenshot: 'workcrate-page-export.png' }
  await writeFile(join(outDir, 'workcrate-export.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { cdp.close() }
