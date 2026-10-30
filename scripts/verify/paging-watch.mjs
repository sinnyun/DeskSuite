import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, outDir } from './common.mjs'

ensureOutDir()
const fixtureDir = join(outDir, 'paging-watch-fixture')
await rm(fixtureDir, { recursive: true, force: true })
await mkdir(fixtureDir, { recursive: true })
for (let index = 0; index < 501; index += 1) {
  await writeFile(join(fixtureDir, `entry-${String(index).padStart(4, '0')}.txt`), String(index))
}

const client = await connectCdp()
try {
  let page = await client.evaluate(
    `window.bridge.invoke('filesystem', 'listDir', ${JSON.stringify(fixtureDir)}, 200)`
  )
  const entries = [...page.entries]
  assert.equal(entries.length, 200)
  while (page.nextCursor) {
    page = await client.evaluate(
      `window.bridge.invoke('filesystem', 'listMore', ${JSON.stringify(page.nextCursor)}, 200)`
    )
    assert.equal(page.stale, false)
    entries.push(...page.entries)
  }
  assert.equal(entries.length, 501, 'all pages should contain all fixture entries')
  assert.equal(new Set(entries.map((entry) => entry.path)).size, 501, 'pages should not overlap')

  await client.evaluate(`window.__f3EventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { stop(); reject(new Error('fs:changed timeout')) }, 5000)
    const stop = window.bridge.onEvent((channel, payload) => {
      if (channel !== 'fs:changed' || !Array.isArray(payload?.dirs) || !payload.dirs.includes(${JSON.stringify(fixtureDir)})) return
      clearTimeout(timeout)
      stop()
      resolve(payload)
    })
  }); true`)
  await client.evaluate(
    `window.bridge.invoke('watch', 'setPaneDirectories', 'verify-f3', [${JSON.stringify(fixtureDir)}])`
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
  const changedName = `watch-${Date.now()}.txt`
  await writeFile(join(fixtureDir, changedName), 'watch')
  const event = await client.evaluate('window.__f3EventPromise')
  assert.equal(event.invalidate, false)
  assert.ok(event.paths.includes(join(fixtureDir, changedName)))

  console.log(JSON.stringify({ pages: Math.ceil(entries.length / 200), entries: entries.length, watched: fixtureDir }))
} finally {
  await client.evaluate(`window.bridge.invoke('watch', 'clearPane', 'verify-f3').catch(() => {})`).catch(() => {})
  await client.evaluate('delete window.__f3EventPromise').catch(() => {})
  client.close()
  await rm(fixtureDir, { recursive: true, force: true })
}
