import assert from 'node:assert/strict'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { ensureOutDir, outDir } from './common.mjs'
import { JobsService } from '../../src/main/services/jobs.ts'
import { AuditService } from '../../src/main/services/audit.ts'

class FakeIpc extends Service {
  constructor(ctx) {
    super(ctx, 'ipc')
    this.events = []
  }

  broadcast(channel, payload) {
    this.events.push({ channel, payload })
  }

  of(channel) {
    return this.events.filter((event) => event.channel === channel)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function pass(message) {
  console.log(`  ok  ${message}`)
}

async function checkJobs() {
  const ctx = new Context()
  const ipc = new FakeIpc(ctx)
  const jobs = new JobsService(ctx)

  const job = jobs.create({ label: '复制 3 项', total: 3, cancelable: true })
  assert.match(job.id, /^job_[0-9a-f]{8}$/)
  job.progress(1, '第 1 项')
  const first = ipc.of('job:progress').at(-1).payload
  assert.equal(first.id, job.id)
  assert.equal(first.done, 1)
  assert.equal(first.detail, '第 1 项')
  assert.equal(first.total, 3)
  assert.equal(first.state, 'running')
  pass('create 后 progress 立即推送 job:progress 首帧（含 done/detail/total）')

  const before = ipc.of('job:progress').length
  for (let i = 2; i <= 21; i += 1) job.progress(i, `第 ${i} 项`)
  const burst = ipc.of('job:progress').length - before
  assert.ok(burst < 20, `20 次 progress 产生了 ${burst} 条广播`)
  pass(`100ms 内连续 20 次 progress 只产生 ${burst} 条广播（< 20，节流生效）`)

  await sleep(150)
  const latest = ipc.of('job:progress').at(-1).payload
  assert.equal(latest.done, 21)
  assert.equal(latest.detail, '第 21 项')
  pass('等待 150ms 后收到节流尾部广播，携带最新进度 done=21')

  job.finish({ ok: 3 })
  const doneEvent = ipc.of('job:done').at(-1).payload
  assert.equal(doneEvent.id, job.id)
  assert.equal(doneEvent.state, 'done')
  assert.deepEqual(doneEvent.summary, { ok: 3 })
  assert.equal(typeof doneEvent.endedAt, 'number')
  assert.equal(jobs.get(job.id).snapshot().state, 'done')
  pass('finish 后状态 done、写入 endedAt/summary，并推送 job:done 广播')

  job.finish({ ok: 999 })
  job.fail(new Error('迟到的失败'))
  const settled = job.snapshot()
  assert.equal(settled.state, 'done')
  assert.deepEqual(settled.summary, { ok: 3 })
  assert.equal(settled.error, undefined)
  pass('重复 finish/fail 不改写终态与 summary（先到先得）')

  const canceledJob = jobs.create({ label: '取消示例', cancelable: true })
  assert.equal(jobs.cancel(canceledJob.id), true)
  assert.equal(canceledJob.signal.aborted, true)
  assert.equal(canceledJob.snapshot().state, 'canceled')
  assert.equal(ipc.of('job:done').at(-1).payload.id, canceledJob.id)
  canceledJob.finish()
  assert.equal(canceledJob.snapshot().state, 'canceled')
  pass('cancel 生效：abort signal 已触发、状态 canceled、推送 job:done，且不能改回 done')

  assert.equal(jobs.cancel(canceledJob.id), false)
  assert.equal(jobs.cancel(job.id), false)
  const fixedJob = jobs.create({ label: '不可取消' })
  assert.equal(jobs.cancel(fixedJob.id), false)
  assert.equal(fixedJob.snapshot().state, 'running')
  fixedJob.finish()
  pass('cancel 对已完成任务、非 cancelable 任务返回 false')

  const failedJob = jobs.create({ label: '失败示例', total: 5 })
  failedJob.progress(2, '第 2 项')
  failedJob.fail(new Error('失败原因'))
  assert.equal(failedJob.snapshot().state, 'failed')
  assert.equal(failedJob.snapshot().error, '失败原因')
  assert.equal(ipc.of('job:done').at(-1).payload.state, 'failed')
  const stringFailed = jobs.create({ label: '字符串失败' })
  stringFailed.fail('字符串错误')
  assert.equal(stringFailed.snapshot().error, '字符串错误')
  pass('fail 后状态 failed，error 取自 Error.message 或字符串')

  const sensitiveProbe = 'job-secret-probe'
  const sensitivePath = 'C:\\Users\\audit-user\\private\\job.txt'
  const protectedJob = jobs.create({ label: `复制 token=${sensitiveProbe} ${sensitivePath}` })
  protectedJob.progress(1, `Bearer ${sensitiveProbe} ${sensitivePath}`)
  const protectedProgress = ipc.of('job:progress').at(-1).payload
  assert.ok(!JSON.stringify(protectedProgress).includes(sensitiveProbe))
  assert.ok(!JSON.stringify(protectedProgress).includes(sensitivePath))
  assert.ok(protectedProgress.label.includes('[已脱敏]'))
  assert.ok(protectedProgress.detail.includes('[本机路径]'))
  assert.ok(protectedProgress.detail.length <= 2_000)
  protectedJob.fail(new Error(`认证失败 token=${sensitiveProbe} ${sensitivePath}${'x'.repeat(3_000)}`))
  const protectedDone = ipc.of('job:done').at(-1).payload
  assert.ok(protectedDone.error.length <= 2_000)
  assert.ok(!JSON.stringify(protectedDone).includes(sensitiveProbe))
  assert.ok(!JSON.stringify(protectedDone).includes(sensitivePath))
  const longErrorJob = jobs.create({ label: '超长错误' })
  longErrorJob.fail('e'.repeat(2_500))
  assert.equal(longErrorJob.snapshot().error.length, 2_000)
  pass('Jobs label/detail/error 在广播与快照中限长，并遮蔽凭据和本机路径')

  const structuredJob = jobs.create({ label: '结构摘要' })
  structuredJob.finish({ copied: 3, paths: [sensitivePath, 'relative/file.txt'], metadata: { apiKey: sensitiveProbe } })
  const structuredSummary = structuredJob.snapshot().summary
  assert.equal(structuredSummary.copied, 3)
  assert.deepEqual(structuredSummary.paths, ['[本机路径]', 'relative/file.txt'])
  assert.equal(structuredSummary.metadata.apiKey, '[已脱敏]')
  const hugeSummaryJob = jobs.create({ label: '超限摘要' })
  hugeSummaryJob.finish(Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, 'x'.repeat(2_500)])))
  assert.deepEqual(hugeSummaryJob.snapshot().summary, { omitted: true, reason: '任务摘要超过 48 KiB 限制' })
  const nested = {}
  let cursor = nested
  for (let index = 0; index < 12; index += 1) { cursor.next = {}; cursor = cursor.next }
  cursor.value = 'deep'
  const deepJob = jobs.create({ label: '深层摘要' })
  deepJob.finish(nested)
  let boundedCursor = deepJob.snapshot().summary
  for (let index = 0; index < 7; index += 1) boundedCursor = boundedCursor.next
  assert.equal(boundedCursor.next, '[深度限制]')
  pass('Jobs summary 保留常见结构、脱敏凭据/路径，并限制嵌套与 48 KiB 总预算')

  assert.ok(jobs.list().some((item) => item.id === failedJob.id))
  for (let i = 0; i < 60; i += 1) {
    const item = jobs.create({ label: `批量任务 ${i}`, total: 1 })
    item.progress(1)
    item.finish({ index: i })
  }
  const list = jobs.list()
  assert.ok(list.length <= 50, `list() 返回 ${list.length} 条，超过 50`)
  assert.ok(list.every((item) => item.state !== 'running'))
  assert.equal(jobs.get(job.id), undefined)
  pass(`60 个任务全部结束后 list() 仅保留 ${list.length} 条已完成快照（≤ 50，最旧的被淘汰）`)
}

async function checkAudit() {
  const auditDir = join(outDir, 'audit-tmp')
  await rm(auditDir, { recursive: true, force: true })

  const audit = new AuditService(new Context(), auditDir)
  await audit.start()
  const baseTs = Date.now()
  audit.record({
    ts: baseTs,
    origin: 'ui',
    tool: 'file_copy',
    allowed: true,
    items: 3,
    results: { ok: 3, failed: 0, files: [{ path: 'relative/file.txt', token: 'audit-secret-probe' }] }
  })
  audit.record({
    ts: baseTs + 1,
    origin: 'mcp',
    tool: 'file_trash',
    access: 'standard',
    allowed: false,
    planId: 'plan_test',
    error: 'MCP 权限不足'
  })
  audit.record({
    ts: baseTs + 2,
    origin: 'command', tool: 'sensitive_failure', allowed: false,
    error: `token=audit-secret-probe C:\\Users\\audit-user\\private\\audit.txt${'x'.repeat(3_000)}`
  })
  audit.record({
    ts: baseTs + 3,
    origin: 'ui', tool: 'oversized_result', allowed: true,
    results: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, 'x'.repeat(2_500)]))
  })
  await audit.flush()

  const entries = await audit.tail(10)
  assert.equal(entries.length, 4)
  assert.equal(typeof entries[0].ts, 'number')
  assert.equal(entries[0].origin, 'ui')
  assert.equal(entries[0].tool, 'file_copy')
  assert.equal(entries[0].allowed, true)
  assert.equal(entries[0].items, 3)
  assert.deepEqual(entries[0].results, { ok: 3, failed: 0, files: [{ path: 'relative/file.txt', token: '[已脱敏]' }] })
  assert.equal(entries[1].origin, 'mcp')
  assert.equal(entries[1].access, 'standard')
  assert.equal(entries[1].allowed, false)
  assert.equal(entries[1].planId, 'plan_test')
  assert.equal(entries[1].error, 'MCP 权限不足')
  assert.ok(entries[2].error.length <= 2_000)
  assert.ok(!entries[2].error.includes('audit-secret-probe'))
  assert.ok(!entries[2].error.includes('C:\\Users\\audit-user'))
  audit.record({ ts: baseTs + 4, origin: 'command', tool: 'long_error', error: 'e'.repeat(2_500) })
  await audit.flush()
  assert.equal((await audit.tail(1))[0].error.length, 2_000)
  assert.deepEqual(entries[3].results, { omitted: true, reason: '审计结果超过 48 KiB 限制' })
  pass('record + flush + tail 读回审计记录，字段一致且按 ts 升序')

  const files = await readdir(auditDir)
  const auditDiskText = (await readFile(join(auditDir, files[0]), 'utf8'))
  assert.ok(!auditDiskText.includes('audit-secret-probe'))
  assert.ok(!auditDiskText.includes('C:\\Users\\audit-user'))
  assert.ok(auditDiskText.includes('[本机路径]'))
  assert.ok(auditDiskText.includes('审计结果超过 48 KiB 限制'))
  pass('JSONL 写入前统一清理错误与结果结构中的凭据/路径，并固定摘要超预算结果')

  assert.equal(files.length, 1)
  assert.match(files[0], /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/)
  pass(`审计文件按天分片写入 ${auditDir}：${files[0]}`)

  const limited = await audit.tail(1)
  assert.equal(limited.length, 1)
  assert.equal(limited[0].tool, 'long_error')
  pass('tail(limit) 返回最后 limit 条')

  const oversizedTailPath = join(auditDir, files[0])
  const recentRows = Array.from({ length: 20_005 }, (_, index) => JSON.stringify({
    ts: Date.now() + index,
    origin: 'command',
    tool: `tail_budget_${index}`,
    allowed: true
  }))
  await writeFile(oversizedTailPath, Buffer.concat([
    Buffer.alloc(5 * 1024 * 1024, 0x78),
    Buffer.from(`\n${recentRows.join('\n')}\n`)
  ]))
  const bounded = await audit.tail(-1)
  assert.equal(bounded.length, 20_000)
  assert.equal(bounded.at(-1)?.tool, 'tail_budget_20004')
  assert.equal(bounded[0].tool, 'tail_budget_5')
  pass('tail 反向分块读取超 4 MiB 文件，并将返回行数限制为最近 20,000 条')

  const missingDir = join(outDir, 'audit-missing', 'nested')
  await rm(join(outDir, 'audit-missing'), { recursive: true, force: true })
  const quiet = console.error
  console.error = () => {}
  let threw = false
  try {
    const audit2 = new AuditService(new Context(), missingDir)
    audit2.record({ origin: 'command', tool: 'demo_greet', allowed: true })
    await audit2.flush()
  } catch {
    threw = true
  } finally {
    console.error = quiet
  }
  assert.equal(threw, false)
  pass('审计目录不存在时 record 与 flush 均不抛错（审计失败不影响业务）')
}

async function main() {
  ensureOutDir()
  await checkJobs()
  await checkAudit()
  console.log('jobs/audit OK')
}

await main()
