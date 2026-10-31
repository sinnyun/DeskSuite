#!/usr/bin/env node
// Run against an isolated full-access DeskSuite instance whose write root is artifacts/verify/samples.
// Creates and reads back a plan through command_run only. It never approves or executes that plan.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()

const sampleRoot = resolve(projectRoot, 'artifacts/verify/samples')
const runDir = join(sampleRoot, `file-operations-decoder-${Date.now()}-${randomUUID().slice(0, 8)}`)
const sourceDir = join(runDir, 'source')
const targetDir = join(runDir, 'target')
const sourcePath = join(sourceDir, 'decoder-sample.txt')
const targetPath = join(targetDir, 'decoder-sample.txt')
const expectedText = `DeskSuite file operations decoder MCP verification ${randomUUID()}`
const report = { checkedAt: new Date().toISOString(), runDir, checks: [], screenshot: null, operationExecuted: false }

function payload(result, label) {
  assert.ok(result, `${label}: empty MCP response`)
  assert.notEqual(result.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: expected JSON result, got ${text.slice(0, 300)}`) }
}

async function call(name, args = {}) {
  return payload(await mcpCall(name, args), name)
}

await mkdir(sourceDir, { recursive: true })
await mkdir(targetDir, { recursive: true })
await writeFile(sourcePath, expectedText, 'utf8')

const commandList = await call('command_list', { filter: 'ipc.file.ops.' })
assert.ok(Array.isArray(commandList), 'command_list did not return the command registry')
const commandIds = new Set(commandList.map((entry) => entry.id))
assert.ok(commandIds.has('ipc.file.ops.plan'), 'expected generic fileOps.plan command to be registered')
assert.ok(commandIds.has('ipc.file.ops.get'), 'expected generic fileOps.get command to be registered')
assert.equal(commandIds.has('ipc.file.ops.approve'), false, 'fileOps.approve must not be exposed through command_run')
assert.equal(commandIds.has('ipc.file.ops.execute'), false, 'fileOps.execute must not be exposed through command_run')
report.checks.push('MCP command_list confirms plan/get are available while approve/execute are intentionally unavailable')

const plan = await call('command_run', {
  id: 'ipc.file.ops.plan',
  params: { args: [{ op: 'copy', sources: [sourcePath], target: targetDir, conflictPolicy: 'cancel' }] }
})
assert.equal(plan.op, 'copy')
assert.equal(typeof plan.planId, 'string')
assert.deepEqual(plan.sources, [sourcePath])
assert.equal(plan.items?.length, 1)
assert.equal(plan.items[0].source, sourcePath)
assert.equal(plan.items[0].target, targetPath)
assert.equal(typeof plan.items[0].targetFingerprint, 'object')
assert.ok(plan.items[0].sourceFingerprint && typeof plan.items[0].sourceFingerprint.size === 'number')
assert.equal('content' in plan, false)
report.planId = plan.planId
report.plan = plan
report.checks.push('MCP command_run created a schema-shaped copy plan without executing it')

const reread = await call('command_run', { id: 'ipc.file.ops.get', params: { args: [plan.planId] } })
assert.equal(reread.planId, plan.planId)
assert.equal(reread.op, plan.op)
assert.deepEqual(reread.sources, plan.sources)
assert.deepEqual(reread.items, plan.items)
assert.equal(reread.expiresAt, plan.expiresAt)
report.checks.push('MCP command_run fileOps.get returned the same decoded plan fields and fingerprints')

const screenshot = mcpImage(await mcpCall('capture_window'))
assert.ok(screenshot?.data, 'capture_window did not return an image')
const screenshotPath = join(outDir, 'file-operations-mcp-decoder.png')
await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
report.screenshot = screenshotPath

const reportPath = join(outDir, 'file-operations-mcp-decoder.json')
await writeFile(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, reportPath }, null, 2))
