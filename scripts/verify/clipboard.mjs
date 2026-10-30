import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, projectRoot } from './common.mjs'

const outDir = ensureOutDir()
const cdp = await connectCdp()
const id = `desksuite-clipboard-verify-${Date.now()}`
const report = { startedAt: new Date().toISOString(), assertions: [], skipped: [], errors: [] }
let backupText = ''
let backupImage = null
const historyIds = []
let didMutateClipboard = false

const invoke = async (method, ...args) => {
  const expression = `window.bridge.invoke('clipboard', ${JSON.stringify(method)}, ...${JSON.stringify(args)})`
  return cdp.evaluate(expression)
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  report.assertions.push(message)
}

try {
  backupText = await invoke('readText')
  backupImage = await invoke('readImage')
  if (await invoke('hasImage') && !backupImage) {
    report.skipped.push('current clipboard image exceeds the reversible backup limit; image history mutation was skipped')
    await mcpHandshake()
    const imageResult = await mcpCall('read_clipboard')
    assert(!imageResult?.isError && Array.isArray(imageResult?.content) && imageResult.content.some((item) => item.type === 'image'), 'MCP read_clipboard returns image content for an image clipboard')
  } else {
    didMutateClipboard = true

    await invoke('writeText', id)
    const textCaptured = await invoke('capture')
    if (textCaptured?.id) historyIds.push(textCaptured.id)
    assert(Boolean(textCaptured?.id), 'temporary text was captured into persistent history')
    const history = await invoke('history')
    assert(history.some((item) => item.id === textCaptured.id && item.content === id), 'history returns captured text')
    await invoke('setFavorite', textCaptured.id, true)
    await invoke('clearHistory')
    const afterClear = await invoke('history')
    assert(afterClear.some((item) => item.id === textCaptured.id && item.favorite), 'clear preserves favorited entries')
    await invoke('setFavorite', textCaptured.id, false)
    await invoke('removeHistory', textCaptured.id)
    assert(!(await invoke('history')).some((item) => item.id === textCaptured.id), 'history entry can be removed')

    const png = readFileSync(join(projectRoot, 'docs', '20261028-010425.png')).toString('base64')
    await invoke('writeImage', `data:image/png;base64,${png}`)
    const imageCaptured = await invoke('capture')
    if (imageCaptured?.id) historyIds.push(imageCaptured.id)
    assert(imageCaptured?.kind === 'image', 'clipboard image is captured as an image history entry')
    const imageData = await invoke('historyImage', imageCaptured.id)
    assert(typeof imageData === 'string' && imageData.startsWith('data:image/png;base64,'), 'stored clipboard image can be read back as PNG')

    await mcpHandshake()
    const mcpResult = await mcpCall('read_clipboard')
    assert(!mcpResult?.isError && Array.isArray(mcpResult?.content) && mcpResult.content.some((item) => item.type === 'image'), 'MCP read_clipboard returns image content')
    report.mcpPreview = mcpText(mcpResult) ?? 'image content'
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
} finally {
  try {
    for (const historyId of historyIds) {
      await invoke('setFavorite', historyId, false)
      await invoke('removeHistory', historyId)
    }
    if (didMutateClipboard) {
      if (backupImage) await invoke('writeImage', backupImage)
      else await invoke('writeText', backupText)
    }
  } catch (error) {
    report.errors.push(`cleanup/clipboard restore failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  cdp.close()
}

report.finishedAt = new Date().toISOString()
writeFileSync(join(outDir, 'clipboard.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (report.errors.length) process.exitCode = 1
