#!/usr/bin/env node
// Verify central IPC/MCP trace capture and open the floating debug panel through DeskSuite MCP.
import { join } from 'node:path'
import { connectCdp, mcpCall, mcpHandshake, mcpText, projectRoot } from './common.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

await mcpHandshake()
const opened = await mcpCall('command_run', { id: 'system.open-debug-console', params: {} })
if (opened?.isError) throw new Error(mcpText(opened) || 'Unable to open debug console')
const secretProbe = `debug-probe-${Date.now()}`
await mcpCall('command_run', { id: 'system.open-debug-console', params: { apiKey: secretProbe } })
const navigate = await mcpCall('quick_bookmarks_explorer', { action: 'navigate', path: projectRoot })
if (navigate?.isError) throw new Error(mcpText(navigate) || 'Unable to navigate the verification pane')
const selectionPath = join(projectRoot, 'package.json')
const selected = await mcpCall('quick_bookmarks_explorer', { action: 'select', paths: [selectionPath] })
if (selected?.isError) throw new Error(mcpText(selected) || 'Unable to select the verification file')

let logs = []
for (let attempt = 0; attempt < 8; attempt += 1) {
  await sleep(250)
  const result = await mcpCall('get_runtime_logs', { limit: 3000 })
  logs = JSON.parse(mcpText(result) || '[]')
  const ipcHistory = logs.some((entry) => entry.source === 'IPC' && entry.message.includes('runtime.history') && entry.phase === '响应')
  const mcpRun = logs.some((entry) => entry.source === 'MCP' && entry.message.includes('command_run') && entry.phase === '响应')
  if (ipcHistory && mcpRun) break
}

const ipcEntries = logs.filter((entry) => entry.source === 'IPC' && entry.message.includes('runtime.history'))
const mcpEntries = logs.filter((entry) => entry.source === 'MCP' && entry.message.includes('command_run'))
const ipcTraceIds = new Set(ipcEntries.map((entry) => entry.traceId).filter(Boolean))
const mcpTraceIds = new Set(mcpEntries.map((entry) => entry.traceId).filter(Boolean))
const actionEntries = logs.filter((entry) => entry.source === 'Event' && entry.message.includes('commands:action'))
const explorerTraceIds = new Set(logs.filter((entry) => entry.source === 'MCP' && entry.message.includes('quick_bookmarks_explorer')).map((entry) => entry.traceId).filter(Boolean))
const explorerEvents = logs.filter((entry) => entry.source === 'Event' && entry.message.includes('quickBookmarks:explorer'))
if (!ipcTraceIds.size) throw new Error('No instrumented IPC runtime.history trace was found')
if (!mcpTraceIds.size) throw new Error('No instrumented MCP command_run trace was found')
if (!actionEntries.some((entry) => mcpTraceIds.has(entry.traceId))) throw new Error('MCP-triggered renderer action did not inherit its trace ID')
if (!explorerEvents.some((entry) => explorerTraceIds.has(entry.traceId))) throw new Error('MCP explorer action event did not retain its trace ID')
if (!ipcEntries.some((entry) => entry.phase === '请求' && entry.payload?.args)) throw new Error('IPC request arguments were not captured')
if (!mcpEntries.some((entry) => entry.phase === '响应' && entry.durationMs !== undefined)) throw new Error('MCP response duration was not captured')
const serializedLogs = JSON.stringify(logs)
if (serializedLogs.includes(secretProbe)) throw new Error('Credential-like MCP arguments were not redacted')

const cdp = await connectCdp()
let visibleText
try {
  visibleText = await cdp.evaluate('document.body.innerText')
} finally {
  cdp.close()
}
if (!visibleText.includes('程序调试信息') || !visibleText.includes('界面渲染') || !visibleText.includes('读取运行记录') || !visibleText.includes('界面事件')) {
  throw new Error('Floating console is missing Chinese renderer-side IPC timeline labels')
}
if (!visibleText.includes('读取文本') || visibleText.includes('filesystem.readText')) {
  throw new Error('Floating console is still showing a raw IPC method alias instead of its Chinese label')
}
const rendererTraceId = ipcEntries.find((entry) => entry.phase === '响应')?.traceId
const traceIndex = rendererTraceId ? visibleText.indexOf(rendererTraceId) : -1
const traceSummary = traceIndex >= 0 ? visibleText.slice(Math.max(0, traceIndex - 120), traceIndex + rendererTraceId.length + 20) : ''
if (!traceSummary.includes('4 个阶段')) throw new Error(`Renderer and main IPC phases are not grouped into one four-phase trace: ${traceSummary}`)

console.log(JSON.stringify({
  panelCommand: mcpText(opened),
  ipcTraceIds: [...ipcTraceIds],
  mcpTraceIds: [...mcpTraceIds],
  correlatedActions: actionEntries.filter((entry) => mcpTraceIds.has(entry.traceId)).length,
  correlatedExplorerEvents: explorerEvents.filter((entry) => explorerTraceIds.has(entry.traceId)).length,
  selectedFile: selectionPath,
  capturedEntries: logs.length,
  credentialRedaction: 'passed',
  rendererTimeline: 'passed',
  chineseDisplayLabels: 'passed',
  rendererMainRoundTripSteps: 4,
  categories: [...new Set(logs.map((entry) => entry.category))]
}, null, 2))
