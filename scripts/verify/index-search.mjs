import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpText, projectRoot } from './common.mjs'

const root = resolve(process.argv[2] || projectRoot)
const timeoutMs = 180_000
const cdp = await connectCdp()
const originalAccess = await cdp.evaluate("window.bridge.invoke('mcp', 'getAccess')")
try {
  await cdp.evaluate("window.bridge.invoke('mcp', 'setAccess', 'standard')")
  await cdp.evaluate(`window.__indexScanDone = null; window.__indexScanUnsub?.(); window.__indexScanUnsub = window.bridge.onEvent((channel, job) => { if (channel === 'job:done' && job?.label?.startsWith('索引扫描')) window.__indexScanDone = job })`)
  const startedText = mcpText(await mcpCall('index_scan', { roots: [root] }))
  const started = JSON.parse(startedText)
  const jobId = started.jobId
  if (!jobId) throw new Error(`index_scan 没有返回 jobId：${startedText}`)
  const startedAt = Date.now()
  let job = null
  while (Date.now() - startedAt < timeoutMs) {
    job = await cdp.evaluate('window.__indexScanDone')
    if (job?.id === jobId) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  if (!job || job.id !== jobId) throw new Error(`索引作业超时：${jobId}`)
  if (job.state !== 'done') throw new Error(`索引作业未成功：${JSON.stringify(job)}`)

  const resultText = mcpText(await mcpCall('search_files', { query: 'ROADMAP.md', root, limit: 20 }))
  const result = JSON.parse(resultText)
  if (!result.items?.some((item) => item.name === 'ROADMAP.md')) {
    throw new Error(`搜索没有找到 ROADMAP.md：${resultText}`)
  }
  const report = { root, job, search: result, completedAt: new Date().toISOString() }
  const outDir = ensureOutDir()
  const outPath = join(outDir, 'index-search.json')
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, outPath, scanned: job.summary, matches: result.total }, null, 2))
} finally {
  await cdp.evaluate('window.__indexScanUnsub?.(); window.__indexScanDone = null').catch(() => {})
  await cdp.evaluate(`window.bridge.invoke('mcp', 'setAccess', ${JSON.stringify(originalAccess)})`).catch(() => {})
  cdp.close()
}
