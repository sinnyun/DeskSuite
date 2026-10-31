#!/usr/bin/env node
// Verify central IPC/MCP trace capture and open the floating debug panel through DeskSuite MCP.
import { join } from 'node:path'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, projectRoot } from './common.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const electronLogPath = join(projectRoot, 'artifacts', 'verify', 'electron.log')
const configuredLogBaseline = Number(process.env.DESKSUITE_VERIFY_ELECTRON_LOG_BASELINE)
const electronLogBaselineBytes = Number.isSafeInteger(configuredLogBaseline) && configuredLogBaseline >= 0
  ? configuredLogBaseline
  : (() => { try { return statSync(electronLogPath).size } catch { return 0 } })()

await mcpHandshake()
const baselineRuntime = await mcpCall('get_runtime_logs', { limit: 3000 })
if (baselineRuntime?.isError) throw new Error(mcpText(baselineRuntime) || 'Unable to read baseline runtime logs')
const baselineLogs = JSON.parse(mcpText(baselineRuntime) || '[]')
const baselineErrorIds = new Set(baselineLogs.filter((entry) => entry.level === 'error').map((entry) => entry.id))
const baselineErrorCount = baselineErrorIds.size
if (baselineErrorCount !== 0) throw new Error(`Fresh runtime profile already has ${baselineErrorCount} error log(s)`)
const statusErrorCount = async () => {
  const statusCdp = await connectCdp()
  try { return await statusCdp.evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((node) => node.title === '打开调试控制台')
  const spans = button ? [...button.children].filter((node) => node.tagName === 'SPAN') : []
  return spans[1]?.innerText?.trim() ?? '0'
})()`) } finally { statusCdp.close() }
}
const baselineStatusErrors = await statusErrorCount()
if (baselineStatusErrors !== '0') throw new Error(`Fresh statusbar error badge is ${baselineStatusErrors}`)
const clipboardHistoryResult = await mcpCall('clipboard_history_list', {})
if (clipboardHistoryResult?.isError) throw new Error(mcpText(clipboardHistoryResult) || 'Unable to read clipboard history metadata')
const clipboardHistory = JSON.parse(mcpText(clipboardHistoryResult) || 'null')
if (!Array.isArray(clipboardHistory)) throw new Error('clipboard_history_list did not return an array')
const existingImage = clipboardHistory.find((item) => item.kind === 'image' && typeof item.id === 'string')
let clipboardImageRead = 'skipped; no existing image history entry'
if (existingImage) {
  const imageResult = await mcpCall('clipboard_history_image', { id: existingImage.id })
  const image = mcpImage(imageResult)
  if (!image || image.mimeType !== 'image/png') throw new Error(mcpText(imageResult) || 'Existing clipboard image history did not return a PNG MCP image block')
  clipboardImageRead = 'passed; reused existing history entry without mutation'
}
const opened = await mcpCall('command_run', { id: 'system.open-debug-console', params: {} })
if (opened?.isError) throw new Error(mcpText(opened) || 'Unable to open debug console')
const secretProbe = `debug-probe-${Date.now()}`
const rawPathProbe = join(projectRoot, 'artifacts', 'verify', 'samples')
const mcpValidation = await mcpCall('settings_validate', {
  namespace: 'appearance',
  value: { theme: 'dark', apiKey: secretProbe, path: rawPathProbe, note: 'token=' + secretProbe }
})
if (mcpValidation?.isError) throw new Error(mcpText(mcpValidation) || 'Unable to create MCP redaction probe')
const ipcValidation = await mcpCall('command_run', {
  id: 'ipc.settings.validate',
  params: { args: ['appearance', { theme: 'dark', accessToken: secretProbe, path: rawPathProbe }] }
})
if (ipcValidation?.isError) throw new Error(mcpText(ipcValidation) || 'Unable to create IPC redaction probe')
const broadcastId = `token=${secretProbe} ${rawPathProbe}`
const broadcastProbe = await mcpCall('command_run', {
  id: 'ui.open-tab',
  params: { region: 'right', id: broadcastId }
})
if (broadcastProbe?.isError) throw new Error(mcpText(broadcastProbe) || 'Unable to create broadcast redaction probe')
const navigate = await mcpCall('quick_bookmarks_explorer', { action: 'navigate', path: rawPathProbe })
if (navigate?.isError) throw new Error(mcpText(navigate) || 'Unable to navigate the verification pane')
const selectionPath = rawPathProbe

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
const settingsMcpStart = logs.find((entry) => entry.source === 'MCP' && entry.message.includes('调用工具 settings_validate') && entry.phase === '请求')
const settingsMcpEnd = logs.find((entry) => entry.source === 'MCP' && entry.message.includes('工具 settings_validate 完成') && entry.phase === '响应')
const clipboardMcpStart = logs.find((entry) => entry.source === 'MCP' && entry.message.includes('调用工具 clipboard_history_list') && entry.phase === '请求')
const clipboardMcpEnd = logs.find((entry) => entry.source === 'MCP' && entry.message.includes('工具 clipboard_history_list 完成') && entry.phase === '响应')
if (!ipcTraceIds.size) throw new Error('No instrumented IPC runtime.history trace was found')
if (!mcpTraceIds.size) throw new Error('No instrumented MCP command_run trace was found')
if (!actionEntries.some((entry) => mcpTraceIds.has(entry.traceId))) throw new Error('MCP-triggered renderer action did not inherit its trace ID')
if (!explorerEvents.some((entry) => explorerTraceIds.has(entry.traceId))) throw new Error('MCP explorer action event did not retain its trace ID')
if (!ipcEntries.some((entry) => entry.phase === '请求' && entry.payload?.args)) throw new Error('IPC request arguments were not captured')
if (!mcpEntries.some((entry) => entry.phase === '响应' && entry.durationMs !== undefined)) throw new Error('MCP response duration was not captured')
if (!settingsMcpStart?.traceId || settingsMcpStart.traceId !== settingsMcpEnd?.traceId) throw new Error('MCP tool-call start/end events were not recorded under the same trace ID')
if (!clipboardMcpStart?.traceId || clipboardMcpStart.traceId !== clipboardMcpEnd?.traceId) throw new Error('clipboard_history_list MCP tool-call start/end events were not recorded under one trace')
const serializedLogs = JSON.stringify(logs)
if (serializedLogs.includes(secretProbe)) throw new Error('Credential-like input or output data was not redacted')
if (serializedLogs.includes(rawPathProbe)) throw new Error('Absolute paths in runtime logs were not redacted')
if (!serializedLogs.includes('[已脱敏]') || !serializedLogs.includes('[本机路径]')) throw new Error('Redaction placeholders were not retained in bounded logs')
const settingsMcpEntry = logs.find((entry) => entry.source === 'MCP' && entry.message.includes('settings_validate') && entry.phase === '请求')
if (!settingsMcpEntry?.payload?.args?.value || settingsMcpEntry.payload.args.value.theme !== 'dark') throw new Error('MCP argument structure was not preserved')
const settingsIpcEntry = logs.find((entry) => entry.source === 'IPC' && entry.message.includes('session.set') && entry.phase === '请求')
if (!Array.isArray(settingsIpcEntry?.payload?.args) || settingsIpcEntry.payload.args[0]?.path !== '[本机路径]' || settingsIpcEntry.payload.args[0]?.viewMode !== 'list') throw new Error('IPC argument structure or path redaction was not preserved')
if (logs.some((entry) => entry.payload && JSON.stringify(entry.payload).length > 48_000)) throw new Error('A runtime log payload exceeded the 48 KB entry budget')
const broadcastEntry = logs.find((entry) => entry.source === 'Event' && entry.message.includes('commands:action') && entry.payload?.data?.action?.includes('tab.open:right:'))
if (!broadcastEntry || JSON.stringify(broadcastEntry).includes(secretProbe) || JSON.stringify(broadcastEntry).includes(rawPathProbe)) throw new Error('Broadcast event payload was not sanitized')

let visibleText
let consoleText
const cdp = await connectCdp()
try {
  visibleText = await cdp.evaluate('document.body.innerText')
  consoleText = await cdp.evaluate(`(() => { const title = [...document.querySelectorAll('[data-ds-type="panel-title"]')].find((node) => node.textContent?.includes('程序调试信息')); return title?.parentElement?.parentElement?.parentElement?.innerText ?? ''; })()`)
} finally {
  cdp.close()
}
if (!visibleText.includes('程序调试信息') || !visibleText.includes('界面渲染') || !visibleText.includes('读取运行记录') || !visibleText.includes('界面事件')) {
  throw new Error('Floating console is missing Chinese renderer-side IPC timeline labels')
}
if (!visibleText.includes('保存窗口会话') || visibleText.includes('session.set')) {
  const aliasAt = visibleText.indexOf('session.set')
  const excerpt = aliasAt >= 0 ? visibleText.slice(Math.max(0, aliasAt - 100), aliasAt + 160) : '缺少“保存窗口会话”中文标签'
  throw new Error(`Floating console IPC label assertion failed: ${excerpt}`)
}
const rendererTraceId = ipcEntries.find((entry) => entry.phase === '响应')?.traceId
const traceIndex = rendererTraceId ? visibleText.indexOf(rendererTraceId) : -1
const traceSummary = traceIndex >= 0 ? visibleText.slice(Math.max(0, traceIndex - 120), traceIndex + rendererTraceId.length + 20) : ''
if (!traceSummary.includes('4 个阶段')) throw new Error(`Renderer and main IPC phases are not grouped into one four-phase trace: ${traceSummary}`)
if (consoleText.includes(secretProbe) || consoleText.includes(rawPathProbe)) throw new Error('Renderer runtime logs exposed a raw probe value')

const capture = await mcpCall('capture_window', {})
const image = mcpImage(capture)
if (!image) throw new Error(mcpText(capture) || 'Unable to capture debug console window')
const screenshot = join(ensureOutDir(), 'debug-console-redaction.png')
writeFileSync(screenshot, Buffer.from(image.data, 'base64'))

const finalRuntime = await mcpCall('get_runtime_logs', { limit: 3000 })
if (finalRuntime?.isError) throw new Error(mcpText(finalRuntime) || 'Unable to read final runtime logs')
const finalLogs = JSON.parse(mcpText(finalRuntime) || '[]')
const newErrors = finalLogs.filter((entry) => entry.level === 'error' && !baselineErrorIds.has(entry.id))
if (newErrors.length) throw new Error(`MCP/IPC exercise added ${newErrors.length} runtime error log(s): ${JSON.stringify(newErrors.slice(0, 3))}`)
const finalStatusErrors = await statusErrorCount()
if (finalStatusErrors !== baselineStatusErrors) throw new Error(`Statusbar error badge changed from ${baselineStatusErrors} to ${finalStatusErrors}`)
if (finalStatusErrors !== '0') throw new Error(`Final statusbar error badge is ${finalStatusErrors}`)
const electronLog = readFileSync(electronLogPath)
if (electronLogBaselineBytes > electronLog.byteLength) throw new Error('electron.log is shorter than the configured pre-launch baseline')
const electronLogDelta = electronLog.subarray(electronLogBaselineBytes).toString('utf8')
const serializationFailures = [
  ...(electronLogDelta.match(/Error sending from webFrameMain: Error: Failed to serialize arguments/g) ?? []),
  ...(electronLogDelta.match(/Error occurred in handler for 'bridge:invoke': Error: An object could not be cloned\./g) ?? [])
]
if (serializationFailures.length) throw new Error(`electron.log gained ${serializationFailures.length} IPC serialization failure(s) after baseline`)

console.log(JSON.stringify({
  panelCommand: mcpText(opened),
  ipcTraceIds: [...ipcTraceIds],
  mcpTraceIds: [...mcpTraceIds],
  correlatedActions: actionEntries.filter((entry) => mcpTraceIds.has(entry.traceId)).length,
  correlatedExplorerEvents: explorerEvents.filter((entry) => explorerTraceIds.has(entry.traceId)).length,
  selectedFile: selectionPath,
  capturedEntries: logs.length,
  credentialRedaction: 'passed',
  pathRedaction: 'passed',
  mcpIpcBroadcastPayloads: 'passed',
  payloadBudget48KiB: 'passed',
  rendererTimeline: 'passed',
  chineseDisplayLabels: 'passed',
  rendererMainRoundTripSteps: 4,
  baselineRuntimeErrors: baselineErrorCount,
  newRuntimeErrors: newErrors.length,
  statusbarErrorCount: finalStatusErrors,
  electronLogBaselineBytes,
  electronLogNewSerializationFailures: serializationFailures.length,
  mcpToolCallStartEnd: 'passed',
  clipboardHistoryImage: clipboardImageRead,
  categories: [...new Set(logs.map((entry) => entry.category))],
  screenshot
}, null, 2))
