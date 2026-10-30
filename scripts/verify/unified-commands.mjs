#!/usr/bin/env node
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpRpc, mcpText, outDir } from './common.mjs'

await mcpHandshake()
const [toolList, commandResult] = await Promise.all([
  mcpRpc('tools/list', {}),
  mcpCall('command_list')
])
const commands = JSON.parse(mcpText(commandResult) ?? '[]')
const commandIds = new Set(commands.map((command) => command.id))
const projected = commands.filter((command) => command.source === 'mcp-tool')
assert.ok(projected.some((command) => command.id === 'mcp.get.app.info'), 'Named MCP operations must project into the shared command registry')
const ipcCommands = commands.filter((command) => command.source === 'ipc')
assert.ok(ipcCommands.length > 0, 'Registered UI IPC methods must be available in the shared command registry')
assert.ok(commands.some((command) => command.id.startsWith('ipc.filesystem.') && command.id.includes('drive')), 'Filesystem UI IPC must project as a command')
const drivesCommand = commands.find((command) => command.id.startsWith('ipc.filesystem.') && command.id.includes('drive'))
const drives = await mcpCall('command_run', { id: drivesCommand.id, params: {} })
assert.ok(Array.isArray(JSON.parse(mcpText(drives) ?? 'null')), 'command_run must call the same UI service handler')
for (const id of ['ui.open-panel', 'ui.close-panel', 'ui.toggle-panel', 'ui.toggle-floating-panel', 'ui.open-tab', 'ui.toggle-sidebar', 'ui.toggle-zen-mode', 'ui.reset-layout', 'ui.clear-debug-log', 'system.reload-renderer', 'system.toggle-font-audit', 'system.set-font-audit']) {
  assert.ok(commandIds.has(id), `UI operation missing from the shared command list: ${id}`)
}

const opened = await mcpCall('command_run', { id: 'ui.open-panel', params: { panel: 'settings' } })
assert.equal(opened.isError, undefined, mcpText(opened) ?? 'Opening Settings through the shared command failed')
await new Promise((resolve) => setTimeout(resolve, 500))

const cdp = await connectCdp()
let rendererCommands
try {
  rendererCommands = await cdp.evaluate("window.bridge.invoke('commands', 'list')")
} finally {
  cdp.close()
}
assert.ok(rendererCommands.some((command) => command.id === 'mcp.search.files'), 'The renderer command API must expose a registered MCP operation')

const image = mcpImage(await mcpCall('capture_window'))
assert.ok(image?.data, 'capture_window must return an image after MCP opened the Settings panel')
ensureOutDir()
const screenshot = join(outDir, 'unified-commands.png')
writeFileSync(screenshot, Buffer.from(image.data, 'base64'))
const enabled = await mcpCall('command_run', { id: 'system.set-font-audit', params: { enabled: true } })
assert.equal(enabled.isError, undefined, mcpText(enabled) ?? 'Enabling font audit through the shared command failed')
await new Promise((resolve) => setTimeout(resolve, 250))
const auditCdp = await connectCdp()
let auditEnabled
try {
  auditEnabled = await auditCdp.evaluate("document.documentElement.classList.contains('desksuite-font-audit')")
} finally {
  auditCdp.close()
}
assert.equal(auditEnabled, true, 'The shared font-audit command must enable semantic color overrides in the renderer')
const auditImage = mcpImage(await mcpCall('capture_window'))
assert.ok(auditImage?.data, 'capture_window must return an image with font-audit mode enabled')
const fontAuditScreenshot = join(outDir, 'unified-commands-font-audit.png')
writeFileSync(fontAuditScreenshot, Buffer.from(auditImage.data, 'base64'))
const disabled = await mcpCall('command_run', { id: 'system.set-font-audit', params: { enabled: false } })
assert.equal(disabled.isError, undefined, mcpText(disabled) ?? 'Disabling font audit through the shared command failed')
await new Promise((resolve) => setTimeout(resolve, 250))
const restoreCdp = await connectCdp()
let auditDisabled
try {
  auditDisabled = await restoreCdp.evaluate("!document.documentElement.classList.contains('desksuite-font-audit')")
} finally {
  restoreCdp.close()
}
assert.equal(auditDisabled, true, 'The shared font-audit command must restore theme colors when disabled')
console.log(JSON.stringify({
  ok: true,
  projectedMcpTools: projected.length,
  ipcCommands: ipcCommands.length,
  commandListCount: commands.length,
  settingsCommand: mcpText(opened),
  screenshot,
  fontAuditScreenshot
}, null, 2))
