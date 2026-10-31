import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const sampleDir = join(projectRoot, 'artifacts', 'verify', 'samples')
await mkdir(sampleDir, { recursive: true })
const samplePath = join(sampleDir, 'resource-decoder-smoke.txt')
const expectedText = '资源 decoder MCP 验收：中文、特殊字符 # %。'
await writeFile(samplePath, expectedText, 'utf8')

const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, `${name}: ${mcpText(result)}`)
  return JSON.parse(mcpText(result))
}
const resource = await call('resource_register', { path: samplePath })
assert.equal(resource.path, samplePath)
assert.equal(resource.available, true)
assert.equal(typeof resource.id, 'string')
const resolved = await call('resource_resolve', { reference: resource.uri })
assert.equal(resolved.id, resource.id)
assert.equal(resolved.revision, resource.revision)
const listed = await call('resource_list')
assert.ok(listed.some((item) => item.id === resource.id))
const bytes = await call('resource_read', { reference: resource.uri, offset: 0, length: 1024 })
assert.equal(Buffer.from(bytes.base64, 'base64').toString('utf8'), expectedText)
assert.equal(bytes.total, Buffer.byteLength(expectedText))
const text = await call('resource_read_text', { reference: resource.uri })
assert.equal(text.text, expectedText)
assert.equal(text.resource.id, resource.id)

await call('resource_view', { action: 'open' })
await call('resource_view', { action: 'preview', reference: resource.uri })
const cdp = await connectCdp()
try {
  const geometry = await cdp.evaluate(`(() => { const panel=document.querySelector('[data-resource-panel]'); return { visible:!!panel, text:panel?.innerText||'' } })()`)
  assert.equal(geometry.visible, true)
  assert.ok(geometry.text.includes('resource-decoder-smoke.txt'))
  assert.ok(geometry.text.includes(expectedText))
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image, 'capture_window did not return an image')
  const { writeFile: saveFile } = await import('node:fs/promises')
  await saveFile(join(outDir, 'resource-decoder-smoke.png'), Buffer.from(image.data, 'base64'))
  const report = { passed: true, resourceId: resource.id, byteLength: bytes.total, checks: ['register/resolve/list/read/readText schema', 'renderer resource preview and text', 'MCP capture_window'] }
  await saveFile(join(outDir, 'resource-decoder-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
