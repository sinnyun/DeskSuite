import assert from 'node:assert/strict'
import { readdir, rm } from 'node:fs/promises'
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
  audit.record({
    origin: 'ui',
    tool: 'file_copy',
    allowed: true,
    items: 3,
    results: { ok: 3, failed: 0 }
  })
  audit.record({
    origin: 'mcp',
    tool: 'file_trash',
    access: 'standard',
    allowed: false,
    planId: 'plan_test',
    error: 'MCP 权限不足'
  })
  await audit.flush()

  const entries = await audit.tail(10)
  assert.equal(entries.length, 2)
  assert.equal(typeof entries[0].ts, 'number')
  assert.equal(entries[0].origin, 'ui')
  assert.equal(entries[0].tool, 'file_copy')
  assert.equal(entries[0].allowed, true)
  assert.equal(entries[0].items, 3)
  assert.deepEqual(entries[0].results, { ok: 3, failed: 0 })
  assert.equal(entries[1].origin, 'mcp')
  assert.equal(entries[1].access, 'standard')
  assert.equal(entries[1].allowed, false)
  assert.equal(entries[1].planId, 'plan_test')
  assert.equal(entries[1].error, 'MCP 权限不足')
  pass('record + flush + tail 读回两条审计记录，字段一致且按 ts 升序')

  const files = await readdir(auditDir)
  assert.equal(files.length, 1)
  assert.match(files[0], /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/)
  pass(`审计文件按天分片写入 ${auditDir}：${files[0]}`)

  const limited = await audit.tail(1)
  assert.equal(limited.length, 1)
  assert.equal(limited[0].tool, 'file_trash')
  pass('tail(limit) 返回最后 limit 条')

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
