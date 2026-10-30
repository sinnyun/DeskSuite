#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const invoke = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, `${name}: ${mcpText(result)}`)
  try { return JSON.parse(mcpText(result)) } catch { return mcpText(result) }
}
const reportFile = join(outDir, 'workcrate-presets.json')
if (process.argv.includes('--check-restart')) {
  const report = JSON.parse(await readFile(reportFile, 'utf8'))
  const presets = await invoke('workcrate_program_presets_get')
  assert.deepEqual(presets, report.saved, 'deleted fields and intentionally empty options must survive restart')
  await invoke('workcrate_program_presets_save', { presets: report.defaults, confirm: true })
  report.restartPassed = true
  await writeFile(reportFile, JSON.stringify(report, null, 2))
  console.log('Restart persistence passed; original suggestions restored.')
} else {
  const defaults = await invoke('workcrate_program_presets_get')
  const required = ['materialCategory', 'material', 'sizeLabel', 'size', 'quantity', 'stock', 'craft', 'color', 'installation']
  for (const key of required) assert.ok(defaults.fields.find((field) => field.key === key)?.values.length >= 6, `${key} needs initial suggestions`)
  const saved = structuredClone(defaults)
  const material = saved.fields.find((field) => field.key === 'material')
  material.values = [...new Set([...material.values, '自定义迎宾立牌'])]
  await invoke('workcrate_program_presets_save', { presets: saved, confirm: true })
  assert.deepEqual(await invoke('workcrate_program_presets_get'), saved)
  const invalid = await mcpCall('workcrate_program_presets_save', { presets: { fields: [saved.fields[0], saved.fields[0]] }, confirm: true })
  assert.ok(invalid.isError, 'duplicate keys must be rejected')
  assert.deepEqual(await invoke('workcrate_program_presets_get'), saved, 'failed writes must preserve prior suggestions')
  const directory = join(outDir, 'samples', `WorkCratePresets-${Date.now()}`)
  await mkdir(directory, { recursive: true })
  await invoke('workcrate_vectorcraft_config_set', { config: { cliExecutable: process.env.VECTORCRAFT_CLI_PATH || 'C:\\Program Files\\VectorCraft\\vectorcraft-cli.exe', port: 17984 }, confirm: true })
  const created = await invoke('workcrate_project_create', { name: `基础信息验收-${Date.now()}`, directory, confirm: true })
  const boardId = created.boards[0].id
  const info = Object.fromEntries(required.slice(0, 5).map((key) => [key, saved.fields.find((field) => field.key === key).values[0]]))
  info.material = '自定义迎宾立牌'
  info.extra = Object.fromEntries(required.slice(5).map((key) => { const field = saved.fields.find((item) => item.key === key); return [field.label, field.values[0]] }))
  await invoke('workcrate_board_update_info', { boardId, info, confirm: true })
  await invoke('workcrate_boards_refresh', { projectId: created.project.id })
  assert.deepEqual((await invoke('workcrate_board_catalog', { projectId: created.project.id }))[0].info, info)
  const cdp = await connectCdp()
  const waitFor = async (expression) => {
    for (let count = 0; count < 40; count++) {
      if (await cdp.evaluate(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error(`UI assertion timed out: ${expression}`)
  }
  const capture = async (file) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    const result = await mcpCall('capture_window')
    const image = mcpImage(result)
    assert.ok(image?.data)
    await writeFile(join(outDir, file), Buffer.from(image.data, 'base64'))
  }
  try {
    await invoke('workcrate_panel_open', { section: 'basic' })
    await waitFor("document.querySelectorAll('[data-basic-information] textarea').length === 9")
    const settingsGeometry = await cdp.evaluate(`(() => { const panel=document.querySelector('[data-workcrate-view]').getBoundingClientRect(); const footer=document.querySelector('[data-workcrate-notifications]').getBoundingClientRect(); return {bottomGap:panel.bottom-footer.bottom, height:panel.height} })()`)
    assert.ok(Math.abs(settingsGeometry.bottomGap) <= 2, 'notifications must sit at panel bottom')
    await capture('workcrate-basic-information.png')
    await invoke('workcrate_panel_open', { projectId: created.project.id, boardId })
    await waitFor("document.querySelector('[data-workcrate-view]')?.dataset.workcrateView === 'page' && [...document.querySelectorAll('input')].some(input=>input.value==='自定义迎宾立牌')")
    const controls = await cdp.evaluate(`(() => {const panel=document.querySelector('[data-workcrate-view]'); return [...panel.querySelectorAll('select')].map(select=>({title:select.title,options:[...select.options].map(option=>option.value),width:select.getBoundingClientRect().width})) })()`)
    assert.equal(controls.length, 13, 'five material inputs and both inputs of four extra rows need dropdowns')
    assert.ok(controls.find((control) => control.title === '物料名称基础信息').options.includes('自定义迎宾立牌'))
    assert.ok(controls.some((control) => /^参数 .* 内容基础信息$/.test(control.title) && control.options.includes('KT板')))
    assert.ok(controls.every((control) => control.width >= 50), 'dropdown controls must remain usable')
    await capture('workcrate-material-presets.png')
  } finally { cdp.close() }
  // Leave intentional deletions for the restart assertion, then restore in that mode.
  saved.fields = saved.fields.filter((field) => field.key !== 'installation')
  saved.fields.find((field) => field.key === 'quantity').values = []
  await invoke('workcrate_program_presets_save', { presets: saved, confirm: true })
  const report = { projectId: created.project.id, boardId, defaults, saved, restartPassed: false, passed: ['seeded-nine-fields', 'save-read-roundtrip', 'invalid-write-preserves-data', 'native-material-roundtrip', 'settings-tab', 'bottom-notifications', 'five-main-and-eight-extra-dropdowns'], screenshots: ['workcrate-basic-information.png', 'workcrate-material-presets.png'] }
  await writeFile(reportFile, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, defaults: undefined, saved: undefined }, null, 2))
}
