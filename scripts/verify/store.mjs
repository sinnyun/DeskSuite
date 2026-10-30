import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Context } from 'cordis'
import { ensureOutDir } from './common.mjs'
import { StoreError, StoreService } from '../../src/main/services/store.ts'
import {
  PathError,
  assertWritable,
  identity,
  isEqualOrInside,
  isInside,
  normalize,
  samePath,
  toLongPath
} from '../../src/main/services/paths.ts'

const isWindows = process.platform === 'win32'
const root = join(ensureOutDir(), 'store-tmp')

function step(label) {
  console.log(`- ${label}`)
}

async function expectStoreError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StoreError, `期望 StoreError，实际 ${error?.constructor?.name}`)
    assert.equal(error.code, code)
    return true
  })
}

async function expectPathError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof PathError, `期望 PathError，实际 ${error?.constructor?.name}`)
    assert.equal(error.code, code)
    return true
  })
}

async function main() {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })

  const ctx = new Context()
  const store = new StoreService(ctx, root)
  await store.start()

  step('store 已注册到根 Context')
  assert.ok(ctx.store instanceof StoreService)
  assert.equal(typeof ctx.store.read, 'function')

  step('未注册 key 的读取 / 写入 / 更新抛 unregistered')
  await expectStoreError(store.read('missing'), 'unregistered')
  await expectStoreError(store.write('missing', 1), 'unregistered')
  await expectStoreError(store.update('missing', (value) => value), 'unregistered')

  step('注册非法 key 抛 invalid-key')
  assert.throws(
    () => store.register('Bad Key', { schema: z.number(), default: 0 }),
    (error) => error instanceof StoreError && error.code === 'invalid-key'
  )

  store.register('counter', { schema: z.number().int(), default: 0 })
  store.register('doc', { schema: z.object({ v: z.number() }), default: { v: 0 } })
  store.register('fresh', { schema: z.object({ name: z.string() }), default: { name: 'x' } })
  store.register('future', { schema: z.object({ v: z.number() }), default: { v: 0 } })
  store.register('serial', { schema: z.number().int(), default: 0 })
  store.registerDocument('nested-doc', 'jobs/job-001.json', {
    schema: z.object({ jobId: z.string() }),
    default: { jobId: '' }
  })

  step('listKeys / has 反映注册表')
  assert.ok(store.has('counter'))
  assert.equal(store.has('missing'), false)
  assert.deepEqual(store.listKeys().sort(), ['counter', 'doc', 'fresh', 'future', 'nested-doc', 'serial'])

  step('注册文档路径拒绝绝对路径与目录逃逸')
  assert.throws(
    () => store.registerDocument('escape-doc', '../outside.json', { schema: z.string(), default: '' }),
    (error) => error instanceof StoreError && error.code === 'invalid-key'
  )
  assert.throws(
    () => store.registerDocument('absolute-doc', join(root, 'outside.json'), { schema: z.string(), default: '' }),
    (error) => error instanceof StoreError && error.code === 'invalid-key'
  )

  step('空目录 read 返回 default')
  assert.equal(await store.read('counter'), 0)
  assert.deepEqual(await store.read('doc'), { v: 0 })
  assert.equal(existsSync(join(root, 'counter.json')), false)
  assert.deepEqual(await store.read('nested-doc'), { jobId: '' })
  assert.equal(existsSync(join(root, 'jobs', 'job-001.json')), false)

  step('store 注册文档写入子目录并保留版本信封')
  await store.write('nested-doc', { jobId: 'job-001' })
  assert.deepEqual(await store.read('nested-doc'), { jobId: 'job-001' })
  const nestedRaw = readFileSync(join(root, 'jobs', 'job-001.json'), 'utf8')
  assert.equal(JSON.parse(nestedRaw).version, 1)

  step('write → read 往返一致')
  await store.write('doc', { v: 7 })
  assert.deepEqual(await store.read('doc'), { v: 7 })

  step('schema 不合法时 write 抛 invalid-value 且不落盘')
  await expectStoreError(store.write('fresh', { name: 123 }), 'invalid-value')
  assert.equal(existsSync(join(root, 'fresh.json')), false)
  assert.equal(existsSync(join(root, 'fresh.json.tmp')), false)

  step('主文件损坏时 read 回退 .bak')
  await store.write('doc', { v: 8 })
  const backupRaw = readFileSync(join(root, 'doc.json.bak'), 'utf8')
  assert.deepEqual(JSON.parse(backupRaw).data, { v: 7 })
  writeFileSync(join(root, 'doc.json'), '{ 这不是合法 JSON')
  assert.deepEqual(await store.read('doc'), { v: 7 })

  step('遗留的 .tmp 文件被忽略')
  await store.write('counter', 42)
  writeFileSync(join(root, 'counter.json.tmp'), '垃圾内容，不是信封')
  assert.equal(await store.read('counter'), 42)

  step('高版本文件拒绝加载、拒绝写入且内容不变')
  const futureFile = join(root, 'future.json')
  const futureRaw = JSON.stringify({ version: 999, data: { v: 5 } }, null, 2)
  writeFileSync(futureFile, futureRaw)
  await expectStoreError(store.read('future'), 'version-too-new')
  await expectStoreError(store.write('future', { v: 6 }), 'version-too-new')
  assert.equal(readFileSync(futureFile, 'utf8'), futureRaw)

  step('并发 10 次 update(x => x + 1) 串行完成，最终为 10')
  await Promise.all(
    Array.from({ length: 10 }, () =>
      store.update('serial', async (current) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return current + 1
      })
    )
  )
  assert.equal(await store.read('serial'), 10)

  step('磁盘 JSON 是含 version 的 2 空格缩进信封')
  const serialRaw = readFileSync(join(root, 'serial.json'), 'utf8')
  assert.ok(serialRaw.includes('\n  "version": 1'))
  const serialEnvelope = JSON.parse(serialRaw)
  assert.equal(serialEnvelope.version, 1)
  assert.equal(serialEnvelope.data, 10)
  assert.equal('value' in serialEnvelope, false)

  step('normalize 去掉尾部分隔符并保留文件系统根')
  if (isWindows) {
    assert.equal(normalize('C:\\a\\b\\'), 'C:\\a\\b')
    assert.equal(normalize('C:\\'), 'C:\\')
  } else {
    assert.equal(normalize('/tmp/a/b/'), '/tmp/a/b')
    assert.equal(normalize('/'), '/')
  }

  step('identity / samePath 在 Windows 上大小写不敏感')
  if (isWindows) {
    assert.equal(identity('C:\\Temp\\A'), 'c:\\temp\\a')
    assert.equal(samePath('C:\\Temp\\A', 'c:\\temp\\a'), true)
    assert.equal(samePath('C:\\Temp\\A', 'C:\\Temp\\AB'), false)
  } else {
    assert.equal(samePath('/tmp/a', '/tmp/a'), true)
    assert.equal(samePath('/tmp/a', '/tmp/a/b'), false)
  }

  step('isInside 按分隔符边界比较，isEqualOrInside 含相等')
  if (isWindows) {
    assert.equal(isInside('C:\\a', 'C:\\ab'), false)
    assert.equal(isInside('C:\\a', 'C:\\a\\b'), true)
    assert.equal(isInside('C:\\a', 'C:\\a'), false)
    assert.equal(isEqualOrInside('C:\\a', 'C:\\a'), true)
  } else {
    assert.equal(isInside('/a', '/ab'), false)
    assert.equal(isInside('/a', '/a/b'), true)
    assert.equal(isInside('/a', '/a'), false)
    assert.equal(isEqualOrInside('/a', '/a'), true)
  }

  step('toLongPath 在 Windows 上为长路径加 \\\\?\\ 前缀')
  if (isWindows) {
    const segments = Array.from({ length: 30 }, (_, index) => `segment-${index}`)
    const longPath = `C:\\${segments.join('\\')}`
    assert.ok(longPath.length >= 248)
    assert.equal(toLongPath(longPath).startsWith('\\\\?\\C:\\'), true)
    assert.equal(toLongPath('C:\\short'), 'C:\\short')
    assert.equal(toLongPath('\\\\?\\C:\\already-long'), '\\\\?\\C:\\already-long')
    const longUnc = `\\\\server\\share\\${'x'.repeat(240)}`
    assert.equal(toLongPath(longUnc).startsWith('\\\\?\\UNC\\server\\share\\'), true)
  } else {
    assert.equal(toLongPath('/tmp/x'), '/tmp/x')
  }

  step('assertWritable 在 allowedRoots 为空时抛 no-write-roots')
  await expectPathError(assertWritable(join(root, 'x.txt'), { allowedRoots: [] }), 'no-write-roots')

  step('assertWritable 拒绝文件系统根')
  const volumeRoot = isWindows ? 'C:\\' : '/'
  await expectPathError(assertWritable(volumeRoot, { allowedRoots: [volumeRoot] }), 'root-path')

  step('assertWritable 拒绝 allowedRoots 之外的路径')
  const outside = join(root, '..', 'store-outside.txt')
  await expectPathError(assertWritable(outside, { allowedRoots: [root] }), 'outside-roots')

  step('assertWritable 拒绝 forbidden 内的路径')
  await expectPathError(
    assertWritable(join(root, 'blocked', 'x.txt'), {
      allowedRoots: [root],
      forbidden: [join(root, 'blocked')]
    }),
    'forbidden-path'
  )

  if (isWindows) {
    step('assertWritable 在 Windows 上默认拒绝系统目录')
    await expectPathError(
      assertWritable('C:\\Windows\\System32\\x.txt', { allowedRoots: ['C:\\'] }),
      'forbidden-path'
    )
  }

  step('assertWritable 允许临时目录内的目标并返回规范化路径')
  const allowedTarget = join(root, 'nested', 'file.txt')
  assert.equal(await assertWritable(allowedTarget, { allowedRoots: [root] }), normalize(allowedTarget))

  const escapeLink = join(root, 'escape')
  let linkReady = false
  try {
    symlinkSync(isWindows ? 'C:\\Windows' : '/etc', escapeLink, isWindows ? 'junction' : 'dir')
    linkReady = true
  } catch {
    console.log('  （当前环境无法创建符号链接，跳过逃逸用例）')
  }
  if (linkReady) {
    step('assertWritable 拒绝经符号链接逃逸的路径')
    await expectPathError(
      assertWritable(join(escapeLink, 'system.ini'), { allowedRoots: [root] }),
      'symlink-escape'
    )
  }

  console.log('store/paths OK')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
