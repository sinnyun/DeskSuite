import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir } from './common.mjs'

const cdp = await connectCdp()
const report = { startedAt: new Date().toISOString(), assertions: [], errors: [] }
const invoke = async (method, ...args) => {
  const expression = `window.bridge.invoke('launcher', ${JSON.stringify(method)}, ...${JSON.stringify(args)})`
  return cdp.evaluate(expression)
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  report.assertions.push(message)
}

try {
  const entries = await invoke('list')
  assert(Array.isArray(entries) && entries.length <= 250, 'launcher returns at most 250 entries')
  if (entries.length) {
    const entry = entries[0]
    assert(typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.path === 'string', 'entry includes id, name and launch path')
    const matching = await invoke('list', entry.name.slice(0, Math.max(1, Math.min(3, entry.name.length))))
    assert(matching.some((item) => item.id === entry.id), 'name filter returns the matching launcher entry')
    const icon = await invoke('icon', entry.id)
    assert(icon === null || typeof icon === 'string' && icon.startsWith('data:image/'), 'icon returns an image data URL or null')
  } else {
    report.skipped = ['no launcher entries available for search/icon checks']
  }
} catch (error) {
  report.errors.push(error instanceof Error ? error.message : String(error))
} finally {
  cdp.close()
}

report.finishedAt = new Date().toISOString()
writeFileSync(join(ensureOutDir(), 'launcher.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (report.errors.length) process.exitCode = 1
