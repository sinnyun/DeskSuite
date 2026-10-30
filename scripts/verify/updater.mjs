#!/usr/bin/env node
// Read-only updater wiring check. It never checks the network or downloads/installs an update.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, outDir } from './common.mjs'

const cdp = await connectCdp()
try {
  const state = await cdp.evaluate("window.bridge.invoke('updater', 'get')")
  if (!state || typeof state.currentVersion !== 'string' || typeof state.packaged !== 'boolean') {
    throw new Error(`updater.get 返回结构无效：${JSON.stringify(state)}`)
  }
  const report = {
    checkedAt: new Date().toISOString(),
    state,
    automaticDownloadDisabled: true,
    networkCheckPerformed: false,
    installPerformed: false
  }
  ensureOutDir()
  const file = join(outDir, 'updater.json')
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ file, ...report }, null, 2))
} finally {
  cdp.close()
}
