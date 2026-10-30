#!/usr/bin/env node
// 用法：先运行 launch.mjs，再运行 node scripts/verify/files.mjs [--root <已配置写入根目录>]
import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, parseFlags } from './common.mjs'
import { writeFileSync } from 'node:fs'

const { flags } = parseFlags(process.argv.slice(2))
const results = []
const record = (name, data) => {
  results.push({ name, ...data })
  console.log(`${data.ok ? 'PASS' : 'FAIL'}  ${name}${data.detail ? ` -> ${data.detail}` : ''}`)
}

let cdp
let testRoot
let runFolder
let failed = false

async function bridgeCall(method, ...args) {
  const encoded = JSON.stringify(args)
  return cdp.evaluate(`window.bridge.invoke('fileOps', ${JSON.stringify(method)}, ...${encoded})`)
}

async function waitForResult(jobId) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const saved = await bridgeCall('getResults')
    const result = saved?.find((entry) => entry.jobId === jobId)
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`作业 ${jobId} 在 30 秒内没有保存结果`)
}

async function runPlan(input) {
  const plan = await bridgeCall('plan', input)
  assert.ok(plan?.planId, `计划未创建：${JSON.stringify(plan)}`)
  assert.equal(await bridgeCall('approve', plan.planId), true, '计划未能批准')
  const { jobId } = await bridgeCall('execute', plan.planId)
  assert.ok(jobId, '执行没有返回 jobId')
  return waitForResult(jobId)
}

function expectStatus(saved, status, label) {
  assert.equal(saved.results.length, 1, `${label} 应返回一项结果`)
  assert.equal(saved.results[0].status, status, `${label} 状态不符`)
  record(label, { ok: true, detail: status })
}

function mcpPayload(result) {
  const text = mcpText(result)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

try {
  cdp = await connectCdp()
  const roots = await bridgeCall('getWriteRoots')
  const requestedRoot = flags.root ? resolve(String(flags.root)) : null
  testRoot = requestedRoot ?? roots?.[0]
  assert.ok(testRoot, '尚未配置 mcp.writeRoots；请传入 --root 指向已配置且可写的根目录')
  assert.ok(roots.some((root) => resolve(root).toLowerCase() === resolve(testRoot).toLowerCase()), '--root 必须属于 mcp.writeRoots')
  runFolder = await mkdtemp(join(testRoot, '.desksuite-file-ops-verify-'))
  const copySource = join(runFolder, 'copy.txt')
  const copyTarget = join(runFolder, 'copy-target')
  const moveSource = join(runFolder, 'move.txt')
  const moveTarget = join(runFolder, 'move-target')
  const renameSource = join(runFolder, 'rename-before.txt')
  const renameTarget = join(runFolder, 'rename-after.txt')
  const trashSource = join(runFolder, 'trash-test.txt')
  await Promise.all([mkdir(copyTarget), mkdir(moveTarget)])
  await Promise.all([
    writeFile(copySource, 'copy payload'),
    writeFile(moveSource, 'move payload'),
    writeFile(renameSource, 'rename payload'),
    writeFile(trashSource, 'temporary trash verification payload')
  ])

  const notePath = join(runFolder, 'verified-note.md')
  const noteContent = '---\ntitle: 验证笔记\ntags: [desk-suite]\n---\n\n# 文件计划写入\n'
  const notePlan = await bridgeCall('writeText', notePath, noteContent)
  assert.ok(notePlan?.planId, 'Markdown 写入计划没有创建')
  assert.equal(await bridgeCall('approve', notePlan.planId), true, 'Markdown 写入计划未能批准')
  const noteJob = await bridgeCall('execute', notePlan.planId)
  expectStatus(await waitForResult(noteJob.jobId), 'completed', '安全计划写入 Markdown 笔记')
  assert.equal(await readFile(notePath, 'utf8'), noteContent)

  const copied = await runPlan({ op: 'copy', sources: [copySource], target: copyTarget, conflictPolicy: 'cancel' })
  expectStatus(copied, 'completed', '复制')
  assert.equal(await readFile(join(copyTarget, basename(copySource)), 'utf8'), 'copy payload')

  const moved = await runPlan({ op: 'move', sources: [moveSource], target: moveTarget, conflictPolicy: 'cancel' })
  expectStatus(moved, 'completed', '移动')
  assert.equal(await readFile(join(moveTarget, basename(moveSource)), 'utf8'), 'move payload')
  const moveUndo = (await bridgeCall('getUndoStack')).find((entry) => entry.op === 'move')
  assert.ok(moveUndo, '同卷移动没有进入撤销栈')
  const movedBack = await bridgeCall('undo', moveUndo.undoId)
  assert.ok(movedBack?.jobId, `移动撤销未启动：${JSON.stringify(movedBack)}`)
  expectStatus(await waitForResult(movedBack.jobId), 'completed', '撤销移动')
  assert.equal(await readFile(moveSource, 'utf8'), 'move payload')

  const renamed = await runPlan({ op: 'rename', sources: [renameSource], target: renameTarget, conflictPolicy: 'cancel' })
  expectStatus(renamed, 'completed', '重命名')
  assert.equal(await readFile(renameTarget, 'utf8'), 'rename payload')
  const renameUndo = (await bridgeCall('getUndoStack')).find((entry) => entry.op === 'rename')
  assert.ok(renameUndo, '重命名没有进入撤销栈')
  const renamedBack = await bridgeCall('undo', renameUndo.undoId)
  assert.ok(renamedBack?.jobId, `重命名撤销未启动：${JSON.stringify(renamedBack)}`)
  expectStatus(await waitForResult(renamedBack.jobId), 'completed', '撤销重命名')
  assert.equal(await readFile(renameSource, 'utf8'), 'rename payload')

  const newDirectory = join(runFolder, 'created-directory')
  const madeDirectory = await runPlan({ op: 'mkdir', sources: [], target: newDirectory })
  expectStatus(madeDirectory, 'completed', '新建目录')
  await access(newDirectory)
  const existingDirectory = await runPlan({ op: 'mkdir', sources: [], target: newDirectory })
  expectStatus(existingDirectory, 'skipped', '新建目录目标已存在')

  const trashed = await runPlan({ op: 'trash', sources: [trashSource] })
  expectStatus(trashed, 'completed', '移入回收站')
  await assert.rejects(access(trashSource))

  for (const policy of ['skip', 'overwrite', 'rename', 'cancel']) {
    const source = join(runFolder, `conflict-${policy}-source.txt`)
    const destination = join(runFolder, `conflict-${policy}-target`)
    await mkdir(destination)
    await writeFile(source, `source-${policy}`)
    await writeFile(join(destination, basename(source)), `target-${policy}`)
    const saved = await runPlan({ op: 'copy', sources: [source], target: destination, conflictPolicy: policy })
    const expected = policy === 'skip' ? 'skipped' : policy === 'cancel' ? 'conflict' : 'completed'
    expectStatus(saved, expected, `冲突策略 ${policy}`)
    if (policy === 'skip' || policy === 'cancel') {
      assert.equal(await readFile(join(destination, basename(source)), 'utf8'), `target-${policy}`)
    }
    if (policy === 'overwrite') assert.equal(await readFile(join(destination, basename(source)), 'utf8'), 'source-overwrite')
    if (policy === 'rename') assert.equal(await readFile(join(destination, 'conflict-rename-source (1).txt'), 'utf8'), 'source-rename')
  }

  const staleSource = join(runFolder, 'stale-source.txt')
  const staleTarget = join(runFolder, 'stale-target')
  await mkdir(staleTarget)
  await writeFile(staleSource, 'before')
  const stalePlan = await bridgeCall('plan', { op: 'copy', sources: [staleSource], target: staleTarget, conflictPolicy: 'cancel' })
  await writeFile(staleSource, 'changed after planning')
  assert.equal(await bridgeCall('approve', stalePlan.planId), true)
  const staleJob = await bridgeCall('execute', stalePlan.planId)
  expectStatus(await waitForResult(staleJob.jobId), 'stale', '计划后文件变化')
  assert.equal(await readFile(staleSource, 'utf8'), 'changed after planning')
  await assert.rejects(readFile(join(staleTarget, basename(staleSource)), 'utf8'))

  record('计划后改动来源文件不会复制', { ok: true })

  await mcpHandshake()
  const originalAccess = await cdp.evaluate("window.bridge.invoke('mcp', 'getAccess')")
  const mcpSource = join(runFolder, 'mcp-source.txt')
  const mcpTarget = join(runFolder, 'mcp-target')
  await writeFile(mcpSource, 'mcp approval payload')
  await mkdir(mcpTarget)
  try {
    await cdp.evaluate("window.bridge.invoke('mcp', 'setAccess', 'read')")
    const denied = await mcpCall('file_copy', { sources: [mcpSource], target: mcpTarget, conflictPolicy: 'cancel' })
    assert.equal(denied?.isError, true, 'read 档未拒绝 file_copy')
    assert.equal(mcpPayload(denied)?.code, 'forbidden', 'read 档拒绝没有返回 forbidden')
    record('MCP read 档拒绝 file_copy', { ok: true })

    await cdp.evaluate("window.bridge.invoke('mcp', 'setAccess', 'standard')")
    const pending = await mcpCall('file_copy', { sources: [mcpSource], target: mcpTarget, conflictPolicy: 'cancel' })
    assert.equal(mcpPayload(pending)?.status, 'pending', '未批准的 MCP 文件操作未在超时后返回 pending')
    record('MCP standard 档无人批准时返回 pending', { ok: true })

    await cdp.evaluate(`window.__desksuiteFileOpsApproval = null; window.__desksuiteFileOpsApprovalStop = window.bridge.onEvent((channel, payload) => { if (channel === 'fileOps:approval') window.__desksuiteFileOpsApproval = payload })`)
    const approvedRequest = mcpCall('file_copy', { sources: [mcpSource], target: mcpTarget, conflictPolicy: 'cancel' })
    const approvalDeadline = Date.now() + 10_000
    let approval = null
    while (Date.now() < approvalDeadline && !approval) {
      approval = await cdp.evaluate('window.__desksuiteFileOpsApproval')
      if (!approval) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    assert.ok(approval?.planId, 'MCP 未广播审批请求')
    assert.equal(await bridgeCall('approve', approval.planId), true, '模拟渲染层批准失败')
    const accepted = await approvedRequest
    assert.equal(mcpPayload(accepted)?.status, 'started', '批准后的 MCP 文件操作未启动')
    const acceptedJobId = mcpPayload(accepted)?.jobId
    assert.ok(acceptedJobId, '批准结果未返回 jobId')
    expectStatus(await waitForResult(acceptedJobId), 'completed', 'MCP 人工批准后复制')
    assert.equal(await readFile(join(mcpTarget, basename(mcpSource)), 'utf8'), 'mcp approval payload')
    record('MCP 渲染层批准后可执行', { ok: true })
    await cdp.evaluate('window.__desksuiteFileOpsApprovalStop?.()')
  } finally {
    if (['off', 'read', 'standard', 'full'].includes(originalAccess)) {
      await cdp.evaluate(`window.bridge.invoke('mcp', 'setAccess', ${JSON.stringify(originalAccess)})`)
    }
  }
} catch (error) {
  failed = true
  record('文件操作验证未抛异常', { ok: false, detail: String(error?.message ?? error) })
} finally {
  if (runFolder) {
    try {
      await rm(runFolder, { recursive: true, force: true })
    } catch (error) {
      failed = true
      record('清理临时验证目录', { ok: false, detail: String(error?.message ?? error) })
    }
  }
  cdp?.close()
  const reportPath = join(ensureOutDir(), 'files.json')
  writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), root: testRoot, results }, null, 2))
  console.log(`\n结果 ${failed ? '失败' : '完成'}；报告：${reportPath}`)
  if (results.some((entry) => entry.name === '移入回收站' && entry.ok)) {
    console.log('说明：专用临时文件已按回收站语义移入系统回收站，其他验证目录已清理。')
  }
  if (failed) process.exitCode = 1
}
