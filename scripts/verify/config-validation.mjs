#!/usr/bin/env node
// Isolated config recovery: prepare a malformed profile, then verify normalized values over MCP.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
const oversized = process.argv.includes('--prepare-oversized') || process.argv.includes('--check-oversized')
const profileName = oversized ? 'config-validation-oversized' : 'config-validation'
const profile = resolve(projectRoot, 'artifacts/verify/profiles', profileName)
const profileRelative = relative(resolve(outDir), profile)
if (profileRelative === '..' || profileRelative.startsWith(`..${sep}`) || isAbsolute(profileRelative)) {
  throw new Error('配置验证 profile 必须在 artifacts/verify 内')
}
const configPath = join(profile, 'config.json')
const writeRoot = resolve(projectRoot, 'artifacts/verify/samples')
const reportPath = join(outDir, oversized ? 'config-validation-oversized.json' : 'config-validation.json')
const expectedPath = join(outDir, 'config-validation-oversized-expected.json')

if (process.argv.includes('--prepare') || process.argv.includes('--prepare-oversized')) {
  mkdirSync(profile, { recursive: true })
  const fixture = {
    window: { width: 1, height: 1, x: 'invalid', y: null, maximized: 'true' },
    mcp: { port: 9647, access: 'full', writeRoots: [writeRoot, null, '', 'x'.repeat(32_769)] },
    ...(oversized ? { padding: 'x'.repeat(4 * 1024 * 1024 + 1) } : {})
  }
  const raw = JSON.stringify(fixture, null, 2)
  writeFileSync(configPath, raw, 'utf8')
  if (oversized) {
    const bytes = Buffer.byteLength(raw, 'utf8')
    assert.ok(bytes > 4 * 1024 * 1024, 'fixture must exceed ConfigService 4 MiB read limit')
    writeFileSync(expectedPath, `${JSON.stringify({ configPath, bytes, sha256: createHash('sha256').update(raw).digest('hex') }, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify({ prepared: true, oversized, configPath, bytes: Buffer.byteLength(raw, 'utf8'), fixtureMcpPort: fixture.mcp.port }))
  process.exit(0)
}

if (process.argv.includes('--check-oversized')) {
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
  const original = readFileSync(configPath)
  assert.ok(original.byteLength > 4 * 1024 * 1024)
  assert.equal(createHash('sha256').update(original).digest('hex'), expected.sha256, 'bad config bytes changed before MCP validation')

  await mcpHandshake()
  const command = async (id, args = []) => {
    const result = await mcpCall('command_run', { id, params: { args } })
    assert.notEqual(result.isError, true, mcpText(result))
    return JSON.parse(mcpText(result))
  }
  const appInfo = JSON.parse(await mcpText(await mcpCall('get_app_info')))
  assert.equal(appInfo.name, 'DeskSuite')
  const mcpConfig = await command('ipc.settings.get', ['mcp'])
  assert.deepEqual(mcpConfig, { access: 'read', writeRoots: [] }, 'over-limit config should recover to safe access and write-root defaults')
  assert.equal(new URL(process.env.DESKSUITE_MCP_URL ?? 'http://127.0.0.1:9600/mcp').port, '9600', 'over-limit config should use the default MCP port')
  const windows = JSON.parse(await mcpText(await mcpCall('list_windows')))
  assert.ok(Array.isArray(windows) && windows.length === 1)
  const captureResult = await mcpCall('capture_window')
  const capture = mcpImage(captureResult)
  assert.ok(capture, mcpText(captureResult) ?? 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'config-validation-oversized.png')
  writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'))

  const after = readFileSync(configPath)
  const afterHash = createHash('sha256').update(after).digest('hex')
  assert.equal(afterHash, expected.sha256, 'ConfigService must not overwrite an oversized bad file during recovery')
  const report = {
    checkedAt: new Date().toISOString(), configPath, originalBytes: original.byteLength,
    originalSha256: expected.sha256, afterBytes: after.byteLength, afterSha256: afterHash,
    app: appInfo.name, mcpConfig, mcpPort: 9600, windowCount: windows.length, screenshotPath,
    note: 'Oversize recovery uses the service safe defaults (read access, port 9600, no write roots). Launch flags are ignored with --preserve-config.'
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

await mcpHandshake()
const command = async (id, args = []) => {
  const result = await mcpCall('command_run', { id, params: { args } })
  assert.notEqual(result.isError, true, mcpText(result))
  return JSON.parse(mcpText(result))
}

const appInfo = JSON.parse(await mcpText(await mcpCall('get_app_info')))
assert.equal(appInfo.name, 'DeskSuite')
const mcpConfig = await command('ipc.settings.get', ['mcp'])
assert.equal(mcpConfig.access, 'full', '验证 profile 应保留 full 权限')
assert.deepEqual(mcpConfig.writeRoots, [writeRoot], '错误类型、空值和超长写入根应按字段过滤')
const windows = JSON.parse(await mcpText(await mcpCall('list_windows')))
assert.ok(Array.isArray(windows) && windows.length === 1)

const report = {
  checkedAt: new Date().toISOString(),
  configPath,
  app: appInfo.name,
  mcpPort: new URL(process.env.DESKSUITE_MCP_URL ?? 'http://127.0.0.1:9647/mcp').port,
  normalizedMcp: mcpConfig,
  windowCount: windows.length
}
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
