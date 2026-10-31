#!/usr/bin/env node
// Store size/recovery smoke: prepare a profile fixture before launch; app state is queried and mutated via MCP.
import assert from 'node:assert/strict'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
const profile = resolve(projectRoot, 'artifacts/verify/profiles/store-budget')
const profileRelative = relative(resolve(outDir), profile)
if (profileRelative === '..' || profileRelative.startsWith(`..${sep}`) || isAbsolute(profileRelative)) {
  throw new Error('store budget profile must be inside artifacts/verify')
}
const dataDir = join(profile, 'data')
const mainFile = join(dataDir, 'clipboard-history.json')
const backupFile = `${mainFile}.bak`
const maxBytes = 64 * 1024 * 1024
const primaryMarker = 'oversized-primary-marker'
const backupMarker = 'valid-backup-marker'
const timestamp = Date.now()
const entry = (id, content) => ({ id, kind: 'text', content, category: 'text', favorite: false, createdAt: timestamp, expiresAt: timestamp + 86_400_000 })

if (process.argv.includes('--prepare')) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(backupFile, JSON.stringify({ version: 1, data: [entry('store-budget-backup', backupMarker)] }), 'utf8')
  const primary = JSON.stringify({ version: 1, data: [entry('store-budget-primary', primaryMarker)], padding: 'x'.repeat(maxBytes + 1) })
  writeFileSync(mainFile, primary, 'utf8')
  const bytes = statSync(mainFile).size
  assert.ok(bytes > maxBytes)
  console.log(JSON.stringify({ prepared: true, profile, mainFile, backupFile, mainBytes: bytes, maxBytes }, null, 2))
  process.exit(0)
}

await mcpHandshake()
const report = { checkedAt: new Date().toISOString(), profile, maxBytes, checks: [] }
async function call(name, args = []) {
  const commandId = name.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase()
  const result = await mcpCall('command_run', { id: commandId, params: { args } })
  assert.notEqual(result?.isError, true, `${name}: ${mcpText(result)}`)
  return mcpText(result)
}

const historyBefore = JSON.parse(await call('ipc.clipboard.history'))
assert.ok(historyBefore.some((item) => item.id === 'store-budget-backup' && item.content === backupMarker), 'valid backup must be used when the primary exceeds its byte budget')
assert.ok(!historyBefore.some((item) => item.id === 'store-budget-primary'), 'oversized primary payload must not enter application state')
report.checks.push('oversized primary was skipped and valid .bak data was recovered through MCP')

await call('ipc.clipboard.removeHistory', ['store-budget-noop-write'])
const historyAfterWrite = JSON.parse(await call('ipc.clipboard.history'))
assert.ok(historyAfterWrite.some((item) => item.id === 'store-budget-backup' && item.content === backupMarker), 'write after recovery must retain recovered data')
assert.ok(!historyAfterWrite.some((item) => item.id === 'store-budget-primary'), 'write after recovery must not persist oversized data')
report.checks.push('recovered store remains writable through MCP without importing the oversized payload')

console.log(JSON.stringify(report, null, 2))
