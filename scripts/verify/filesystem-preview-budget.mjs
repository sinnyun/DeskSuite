import assert from 'node:assert/strict'
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

const SAMPLE_NAME = 'filesystem-preview-budget'
const fixtureRoot = resolve(outDir, 'samples', SAMPLE_NAME)
const sampleRoot = resolve(outDir, 'samples')
const expectedProfile = resolve(projectRoot, 'artifacts', 'verify', 'profiles', SAMPLE_NAME)
const normalPath = join(fixtureRoot, 'normal.txt')
const oversizedPath = join(fixtureRoot, 'oversized.txt')
const imagePath = join(fixtureRoot, 'pixel.png')
const oversizedImagePath = join(fixtureRoot, 'oversized.png')
const mediaPath = join(fixtureRoot, 'sample.mp4')
const oversizedMediaPath = join(fixtureRoot, 'oversized.mp4')
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_MEDIA_BYTES = 64 * 1024 * 1024
const within = (root, path) => {
  const rel = relative(root, resolve(path))
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
const samePath = (left, right) => process.platform === 'win32'
  ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
  : resolve(left) === resolve(right)

assert.ok(within(sampleRoot, fixtureRoot), `Fixture path escaped samples: ${fixtureRoot}`)
ensureOutDir()

if (process.argv.includes('--prepare')) {
  try {
    const info = await lstat(fixtureRoot)
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Refusing to replace a non-directory fixture')
    await rm(fixtureRoot, { recursive: true, force: false })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(fixtureRoot, { recursive: true })
  await writeFile(normalPath, 'bounded preview fixture\n', 'utf8')
  await writeFile(oversizedPath, Buffer.alloc(MAX_TEXT_BYTES + 1, 0x61))
  await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9WQAAAAASUVORK5CYII=', 'base64'))
  await writeFile(oversizedImagePath, Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x00))
  await writeFile(mediaPath, Buffer.from('bounded media fixture'))
  await writeFile(oversizedMediaPath, Buffer.alloc(MAX_MEDIA_BYTES + 1, 0x00))
  console.log(JSON.stringify({ prepared: true, fixtureRoot, normalPath, oversizedPath, imagePath, oversizedImagePath, mediaPath, oversizedMediaPath }, null, 2))
  process.exit(0)
}

assert.ok(process.argv.includes('--check'), 'Use --prepare or --check')
for (const path of [fixtureRoot, normalPath, oversizedPath, imagePath, oversizedImagePath, mediaPath, oversizedMediaPath]) {
  assert.ok(within(sampleRoot, path), `Fixture path escaped samples: ${path}`)
}
const rootInfo = await lstat(fixtureRoot)
assert.ok(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'Fixture root must be an ordinary directory')
const normalInfo = await lstat(normalPath)
const oversizedInfo = await lstat(oversizedPath)
const imageInfo = await lstat(imagePath)
const oversizedImageInfo = await lstat(oversizedImagePath)
const mediaInfo = await lstat(mediaPath)
const oversizedMediaInfo = await lstat(oversizedMediaPath)
assert.ok(normalInfo.isFile() && !normalInfo.isSymbolicLink())
assert.ok(oversizedInfo.isFile() && !oversizedInfo.isSymbolicLink())
for (const info of [imageInfo, oversizedImageInfo, mediaInfo, oversizedMediaInfo]) assert.ok(info.isFile())
assert.equal(oversizedInfo.size, MAX_TEXT_BYTES + 1)
assert.equal(oversizedImageInfo.size, MAX_IMAGE_BYTES + 1)
assert.equal(oversizedMediaInfo.size, MAX_MEDIA_BYTES + 1)

await mcpHandshake()
const call = async (name, args = {}) => mcpCall(name, args)
const storageResult = await call('plugin_storage')
assert.notEqual(storageResult?.isError, true, mcpText(storageResult))
const storage = JSON.parse(mcpText(storageResult) ?? '{}')
assert.ok(samePath(storage.userData, expectedProfile),
  `Refusing to use profile ${storage.userData}; expected isolated profile ${expectedProfile}`)
const configResult = await call('command_run', { id: 'ipc.settings.get', params: { args: ['mcp'] } })
assert.notEqual(configResult?.isError, true, mcpText(configResult))
const mcpConfig = JSON.parse(mcpText(configResult) ?? '{}')
assert.equal(mcpConfig.access, 'full')
assert.equal(mcpConfig.writeRoots?.length, 1)
assert.ok(samePath(mcpConfig.writeRoots[0], sampleRoot), 'MCP write root must be exactly artifacts/verify/samples')

const normalResult = await call('read_text_file', { path: normalPath })
assert.notEqual(normalResult?.isError, true, `Normal preview failed: ${mcpText(normalResult)}`)
assert.equal(mcpText(normalResult), 'bounded preview fixture\n')
const oversizedResult = await call('read_text_file', { path: oversizedPath })
assert.equal(oversizedResult?.isError, true, 'Oversized text preview must be rejected')
assert.match(mcpText(oversizedResult) ?? '', /2MB|超过/, 'Oversized rejection should explain the size limit')

const imageRead = await call('filesystem_preview_image', { path: imagePath })
assert.notEqual(imageRead?.isError, true, `Small image preview failed: ${mcpText(imageRead)}`)
assert.equal(mcpImage(imageRead)?.mimeType, 'image/png')
const imageRejected = await call('filesystem_preview_image', { path: oversizedImagePath })
assert.equal(imageRejected?.isError, true, 'Oversized image preview must be rejected')
assert.match(mcpText(imageRejected) ?? '', /12MB|超过/)
const mediaRead = await call('filesystem_inspect_media_preview', { path: mediaPath })
assert.notEqual(mediaRead?.isError, true, `Small media preview failed: ${mcpText(mediaRead)}`)
assert.deepEqual(JSON.parse(mcpText(mediaRead) ?? '{}'), { path: mediaPath, mimeType: 'video/mp4', byteLength: mediaInfo.size })
const mediaRejected = await call('filesystem_inspect_media_preview', { path: oversizedMediaPath })
assert.equal(mediaRejected?.isError, true, 'Oversized media preview must be rejected')
assert.match(mcpText(mediaRejected) ?? '', /64MB|超过/)

const screenshot = mcpImage(await call('capture_window', {}))
assert.ok(screenshot?.mimeType === 'image/png', 'capture_window did not return a PNG image block')
const screenshotPath = join(outDir, 'filesystem-preview-budget.png')
await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
const reportPath = join(outDir, 'filesystem-preview-budget.json')
await writeFile(reportPath, `${JSON.stringify({
  status: 'passed', profile: storage.userData, writeRoots: mcpConfig.writeRoots,
  normalBytes: normalInfo.size, oversizedTextBytes: oversizedInfo.size,
  imageBytes: imageInfo.size, oversizedImageBytes: oversizedImageInfo.size,
  mediaBytes: mediaInfo.size, oversizedMediaBytes: oversizedMediaInfo.size,
  normalTextRead: true, oversizedTextRejected: true, imageRead: true, oversizedImageRejected: true,
  mediaRead: true, oversizedMediaRejected: true, rejection: mcpText(oversizedResult),
  screenshotPath, checkedAt: new Date().toISOString()
}, null, 2)}\n`, 'utf8')
console.log(`filesystem preview bounded-read MCP check passed; report: ${reportPath}; screenshot: ${screenshotPath}`)
