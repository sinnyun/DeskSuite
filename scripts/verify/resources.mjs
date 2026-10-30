import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, open, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir, projectRoot } from './common.mjs'

// Fixtures simulate externally supplied files. All application operations use MCP.
ensureOutDir()
await mcpHandshake()
const checks = []
const root = join(projectRoot, 'artifacts/verify/samples/resource-links')
const expectedPath = join(outDir, 'resources-expected.json')
const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, `${name}: ${mcpText(result)}`)
  return JSON.parse(mcpText(result))
}
const view = (args) => call('resource_view', args)
const resolve = (reference) => call('resource_resolve', { reference })
const fetchResource = (reference, extra = {}) => view({ action: 'fetch', reference, ...extra })
const wait = async (probe) => {
  for (let i = 0; i < 100; i++) {
    const result = await probe()
    if (result) return result
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error('资源预览等待超时')
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')
const ffmpeg = (args) => {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true })
  assert.equal(run.status, 0, run.stderr || run.error?.message)
}
const cdp = await connectCdp()
try {
  let resources
  if (process.argv.includes('--check-restart')) {
    const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
    resources = expected.resources
    for (const resource of resources) {
      const current = await resolve(resource.uri)
      assert.equal(current.id, resource.id)
      assert.equal(current.uri, resource.uri)
      assert.equal(current.revision, resource.revision)
      const actual = await call('resource_read', { reference: resource.uri, length: 65536 })
      assert.equal(sha(Buffer.from(actual.base64, 'base64')), expected.hashes[resource.id])
    }
    checks.push('重启后不同格式的 ID、永久链接、版本及字节保持一致')
  } else {
    await mkdir(root, { recursive: true })
    const paths = {
      image: join(root, '本地图片 # %.png'), video: join(root, '本地视频.webm'),
      text: join(root, '资源 # % [样本].txt'), markdown: join(root, '说明.md'),
      pdf: join(root, '文档.pdf'), binary: join(root, '任意格式.custom'),
      empty: join(root, '空文件.bin'), large: join(root, 'large-sparse.bin'), html: join(root, '原始网页.html')
    }
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=teal:s=320x200', '-frames:v', '1', '-update', '1', paths.image])
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '5', '-c:v', 'libvpx', '-deadline', 'realtime', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', paths.video])
    await writeFile(paths.text, '统一资源链接：中文、空格、#、% 均不进入链接路径。\noriginal bytes')
    await writeFile(paths.markdown, '# 资源说明\n\nMarkdown 保留原格式。')
    await writeFile(paths.pdf, '%PDF-1.4\n% Binary identity fixture; no PDF reader is invoked in this phase.\n%%EOF\n')
    await writeFile(paths.binary, Buffer.from([0, 1, 2, 3, 128, 254, 255]))
    await writeFile(paths.empty, '')
    await writeFile(paths.html, '<script>throw new Error("must not execute")</script><p>原始文件</p>')
    const large = await open(paths.large, 'w')
    await large.truncate(128 * 1024 * 1024 + 17)
    await large.close()
    resources = await Promise.all(Object.values(paths).map((path) => call('resource_register', { path })))
    const byKind = (kind) => resources.find((resource) => resource.kind === kind)
    const duplicates = await Promise.all(Array.from({ length: 12 }, () => call('resource_register', { path: paths.text })))
    assert.ok(duplicates.every((resource) => resource.id === byKind('text').id))
    assert.equal((await call('resource_list')).filter((resource) => resource.path.toLowerCase() === paths.text.toLowerCase()).length, 1)
    checks.push('任意格式统一登记；中文/空格/特殊字符路径；并发重复登记去重')

    for (const resource of resources) {
      const source = await open(resource.path, 'r')
      const expected = Buffer.alloc(Math.min(65536, resource.size))
      await source.read(expected, 0, expected.length, 0)
      await source.close()
      const actual = await call('resource_read', { reference: resource.uri, length: 65536 })
      assert.deepEqual(Buffer.from(actual.base64, 'base64'), expected)
      const head = await fetchResource(resource.uri, { method: 'HEAD' })
      assert.equal(head.status, 200)
      assert.equal(Number(head.headers['content-length']), resource.size)
      assert.equal(head.headers['content-type'], resource.mimeType)
    }
    checks.push('图片/视频/PDF/Markdown/TXT/未知/HTML/空/大文件原始字节与 MIME；渲染进程 HEAD 均通过')

    const binary = resources.find((resource) => resource.path === paths.binary)
    for (const [range, expected] of [['bytes=1-3', [1, 2, 3]], ['bytes=-2', [254, 255]], ['bytes=5-', [254, 255]], ['bytes=0-99', [0, 1, 2, 3, 128, 254, 255]]]) {
      const part = await fetchResource(binary.uri, { range })
      assert.equal(part.status, 206)
      assert.deepEqual([...Buffer.from(part.base64, 'base64')], expected)
    }
    for (const range of ['bytes=99-100', 'bytes=2-1', 'bytes=0-1,3-4', 'bytes=-0', 'bytes=NaN-']) {
      const failed = await fetchResource(binary.uri, { range })
      assert.equal(failed.status, 416)
      assert.equal(failed.headers['content-range'], 'bytes */7')
    }
    assert.equal((await fetchResource(resources.find((resource) => resource.path === paths.empty).uri, { range: 'bytes=0-' })).status, 416)
    const huge = resources.find((resource) => resource.path === paths.large)
    const tail = await fetchResource(huge.uri, { range: `bytes=${huge.size - 17}-` })
    assert.equal(tail.status, 206)
    assert.equal(Buffer.from(tail.base64, 'base64').length, 17)
    assert.equal((await fetchResource(binary.uri, { method: 'POST' })).status, 405)
    const conditional = await fetchResource(binary.uri, { method: 'HEAD' })
    assert.equal((await fetchResource(binary.uri, { etag: conditional.headers.etag })).status, 304)
    assert.equal((await fetchResource(binary.uri, { range: 'bytes=1-3', ifRange: conditional.headers.etag })).status, 206)
    assert.equal((await fetchResource(binary.uri, { range: 'bytes=1-3', ifRange: '"outdated"' })).status, 200)
    checks.push('完整/后缀/开放 Range、206/416、128 MiB 文件尾部、HEAD、ETag/304 与方法拒绝通过')

    const unknown = `desksuite-resource://local/${randomUUID()}/content.bin`
    assert.equal((await view({ action: 'fetch', url: unknown })).status, 404)
    assert.equal((await view({ action: 'fetch', url: binary.uri.replace('/content.custom', '/other.custom') })).status, 400)
    const invalidPath = await mcpCall('resource_register', { path: root })
    assert.ok(invalidPath.isError)
    const relative = await mcpCall('resource_register', { path: 'relative.txt' })
    assert.ok(relative.isError)
    const oversizedRead = await mcpCall('resource_read', { reference: binary.uri, length: 2 * 1024 * 1024 })
    assert.ok(oversizedRead.isError)
    checks.push('未知/伪造链接、目录/相对路径、超限读取拒绝')

    const text = byKind('text')
    const oldUrl = text.url
    await writeFile(paths.text, '外部更新后的资源\nchanged bytes')
    const updated = await resolve(text.uri)
    assert.equal(updated.uri, text.uri)
    assert.notEqual(updated.revision, text.revision)
    assert.equal((await view({ action: 'fetch', url: oldUrl })).status, 409)
    assert.equal((await call('resource_read_text', { reference: text.uri })).text, '外部更新后的资源\nchanged bytes')
    resources = resources.map((resource) => resource.id === updated.id ? updated : resource)
    const missingPath = join(root, 'external-missing.txt')
    await writeFile(missingPath, 'external fixture')
    const missing = await call('resource_register', { path: missingPath })
    await rm(missingPath)
    assert.equal((await resolve(missing.uri)).available, false)
    assert.equal((await fetchResource(missing.uri)).status, 404)
    const revokePath = join(root, 'revoke.txt')
    await writeFile(revokePath, 'source stays unchanged')
    const revoked = await call('resource_register', { path: revokePath })
    await call('resource_forget', { reference: revoked.uri })
    assert.equal((await view({ action: 'fetch', url: revoked.uri })).status, 404)
    assert.equal(await readFile(revokePath, 'utf8'), 'source stays unchanged')
    checks.push('外部修改保持永久 URI、更新版本并拒绝旧 URL；源文件缺失可诊断；取消登记不删除源文件')
  }

  const image = resources.find((resource) => resource.kind === 'image')
  await view({ action: 'preview', reference: image.uri })
  const imageReady = await wait(async () => { const status = await view({ action: 'inspect' }); if (status.image?.error) throw new Error(status.image.error); return status.image?.ready && status })
  assert.equal(imageReady.image.width, 320)
  assert.equal(imageReady.image.height, 200)
  const before = imageReady.cache.leases
  const decoded = await view({ action: 'leafer', reference: image.uri })
  assert.equal(decoded.width, 320)
  assert.equal(decoded.height, 200)
  assert.equal((await view({ action: 'inspect' })).cache.leases, before)
  const shared = await Promise.all(Array.from({ length: 8 }, () => view({ action: 'leafer', reference: image.uri })))
  assert.ok(shared.every((decoded) => decoded.width === 320 && decoded.height === 200))
  assert.equal((await view({ action: 'inspect' })).cache.leases, before)
  checks.push('实际 Leafer 画布使用统一 URL 解码绘制；共享图片租约释放后不增加占用')
  const imageShot = mcpImage(await mcpCall('capture_window'))
  assert.ok(imageShot)
  await writeFile(join(outDir, 'resources-image.png'), Buffer.from(imageShot.data, 'base64'))

  const video = resources.find((resource) => resource.kind === 'video')
  await view({ action: 'preview', reference: video.uri })
  await wait(async () => { const status = await view({ action: 'inspect' }); if (status.media?.error) throw new Error('Media error ' + status.media.error); return status.media?.readyState >= 2 && status.media.duration > 4 })
  await view({ action: 'play' })
  await wait(async () => { const status = await view({ action: 'inspect' }); return status.media?.currentTime > 0.2 })
  await view({ action: 'seek', time: 3 })
  await view({ action: 'pause' })
  await wait(async () => { const status = await view({ action: 'inspect' }); return status.media?.paused && status.media.currentTime >= 2.9 })
  assert.equal((await view({ action: 'inspect' })).cache.leases, 0)
  checks.push('统一 URL 的真实视频播放、跳转进度及暂停通过；切换后图片缓存租约回收')

  const geometry = await cdp.evaluate(`(() => { const panel=document.querySelector('[data-resource-panel]'); const rect=panel?.getBoundingClientRect(); const video=panel?.querySelector('video'); return {width:rect?.width,height:rect?.height,videoWidth:video?.videoWidth,videoHeight:video?.videoHeight,entries:panel?.querySelectorAll('[data-resource-entry]').length,alerts:[...document.querySelectorAll('[role="alert"]')].map(el=>el.textContent)} })()`)
  assert.ok(geometry.width > 700 && geometry.height > 450)
  assert.equal(geometry.videoWidth, 320)
  assert.deepEqual(geometry.alerts, [])
  const shot = mcpImage(await mcpCall('capture_window'))
  assert.ok(shot)
  await writeFile(join(outDir, 'resources-video.png'), Buffer.from(shot.data, 'base64'))
  if (!process.argv.includes('--check-restart')) {
    const hashes = {}
    for (const resource of resources) hashes[resource.id] = sha(Buffer.from((await call('resource_read', { reference: resource.uri, length: 65536 })).base64, 'base64'))
    await writeFile(expectedPath, JSON.stringify({ resources, hashes }, null, 2))
  }
  const report = { at: new Date().toISOString(), passed: true, checks, geometry }
  await writeFile(join(outDir, process.argv.includes('--check-restart') ? 'resources-restart.json' : 'resources.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { cdp.close() }
