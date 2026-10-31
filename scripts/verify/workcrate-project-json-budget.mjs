#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

const mode = process.argv.includes('--prepare') ? 'prepare' : process.argv.includes('--check') ? 'check' : ''
if (!mode || process.argv.includes('--prepare') && process.argv.includes('--check')) {
  throw new Error('用法：node scripts/verify/workcrate-project-json-budget.mjs --prepare|--check [--profile artifacts/verify/profiles/<name>]')
}

ensureOutDir()
const verifyRoot = resolve(projectRoot, 'artifacts', 'verify')
const profileArgIndex = process.argv.indexOf('--profile')
const profileArgument = profileArgIndex >= 0 ? process.argv[profileArgIndex + 1] : 'artifacts/verify/profiles/workcrate-project-json-budget'
if (!profileArgument || profileArgument.startsWith('--')) throw new Error('--profile must name an isolated profile under artifacts/verify')
const profile = resolve(projectRoot, profileArgument)
const projectRootPath = resolve(profile, 'data', 'workcrate', 'projects')
const artifactSuffix = basename(profile)
const expectedPath = join(outDir, `workcrate-project-json-budget-${artifactSuffix}-expected.json`)
const reportPath = join(outDir, `workcrate-project-json-budget-${artifactSuffix}-${mode}.json`)
const screenshotPath = join(outDir, `workcrate-project-json-budget-${artifactSuffix}.png`)
const MAX_PROJECT_DOCUMENT_BYTES = 16 * 1024 * 1024

function isWithin(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function assertWithin(root, candidate, label) {
  const resolved = resolve(candidate)
  assert.ok(isWithin(root, resolved), `${label} escaped its isolated artifacts root: ${resolved}`)
  return resolved
}

assertWithin(verifyRoot, profile, 'profile')

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

async function verifyProfile() {
  const storageResult = await mcpCall('plugin_storage')
  assert.notEqual(storageResult?.isError, true, mcpText(storageResult))
  const storage = JSON.parse(mcpText(storageResult) ?? '{}')
  const actualUserData = resolve(storage.userData ?? '')
  assert.ok(samePath(actualUserData, profile),
    `Refusing to continue: connected MCP instance userData ${actualUserData} is not the fixed isolated profile ${profile}`)
}

async function writeWindowScreenshot() {
  const result = await mcpCall('capture_window', {})
  const image = mcpImage(result)
  assert.ok(image, mcpText(result) ?? 'capture_window did not return an image')
  assert.equal(image.mimeType, 'image/png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
}

await mcpHandshake()
await verifyProfile()

if (mode === 'prepare') {
  try { await stat(expectedPath); throw new Error('Fixture manifest already exists; use a fresh isolated profile and artifacts fixture') }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
  assertWithin(verifyRoot, profile, 'profile')
  assertWithin(profile, projectRootPath, 'isolated WorkCrate project root')
  const projectsBefore = await mcpCall('workcrate_projects_list', { includeArchived: true })
  assert.notEqual(projectsBefore?.isError, true, mcpText(projectsBefore) ?? 'Could not inspect isolated WorkCrate profile')
  assert.equal(JSON.parse(mcpText(projectsBefore) ?? '[]').length, 0, 'WorkCrate profile must not contain pre-existing projects')
  const projectName = `Project JSON budget ${Date.now()}`
  const created = await mcpCall('command_run', {
    id: 'ipc.workcrate.projects.create', params: { args: [projectName] }
  })
  assert.notEqual(created?.isError, true, mcpText(created) ?? 'WorkCrate project create command failed')
  const payload = JSON.parse(mcpText(created) ?? '{}')
  assert.ok(payload.id, 'MCP response must include projectId')
  assert.equal(payload.name, projectName)
  const projectDataPath = assertWithin(projectRootPath, join(projectRootPath, payload.id), 'project data path')
  const projectJsonPath = assertWithin(projectDataPath, join(projectDataPath, 'project.json'), 'project.json path')
  const info = await stat(projectJsonPath)
  assert.ok(info.isFile() && info.size > 0 && info.size <= MAX_PROJECT_DOCUMENT_BYTES)
  const canonicalDataPath = await realpath(projectDataPath)
  const canonicalProjectJson = await realpath(projectJsonPath)
  assertWithin(projectRootPath, canonicalDataPath, 'canonical project data path')
  assertWithin(canonicalDataPath, canonicalProjectJson, 'canonical project.json path')
  assert.ok((await lstat(projectJsonPath)).isFile() && !(await lstat(projectJsonPath)).isSymbolicLink())

  const getResult = await mcpCall('workcrate_project_get', { projectId: payload.id })
  assert.notEqual(getResult?.isError, true, mcpText(getResult) ?? 'created WorkCrate project must be readable')
  const project = JSON.parse(mcpText(getResult) ?? '{}')
  assert.equal(project.project.id, payload.id)
  const original = await readFile(projectJsonPath)
  const manifest = {
    profile, userData: profile, projectId: payload.id, projectDataPath, projectJsonPath,
    originalBytes: original.byteLength, originalSha256: digest(original),
    projectRoot: projectRootPath, createdAt: new Date().toISOString()
  }
  await writeFile(expectedPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeWindowScreenshot()
  const report = { status: 'prepared', ...manifest, screenshotPath }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const manifest = JSON.parse(await readFile(expectedPath, 'utf8'))
assert.ok(samePath(resolve(manifest.profile), profile), 'Fixture was not prepared for this fixed profile')
assert.ok(samePath(resolve(manifest.projectRoot), projectRootPath), 'Fixture project root does not match fixed profile root')
assert.ok(samePath(manifest.userData, profile))
assertWithin(projectRootPath, manifest.projectDataPath, 'manifest project data path')
const projectJsonPath = assertWithin(manifest.projectDataPath, manifest.projectJsonPath, 'manifest project.json path')
const canonicalDataPath = await realpath(manifest.projectDataPath)
const canonicalProjectJson = await realpath(projectJsonPath)
assertWithin(projectRootPath, canonicalDataPath, 'canonical manifest project data path')
assertWithin(canonicalDataPath, canonicalProjectJson, 'canonical manifest project.json path')
const projectJsonInfo = await lstat(projectJsonPath)
assert.ok(projectJsonInfo.isFile() && !projectJsonInfo.isSymbolicLink(), 'project.json must be an ordinary file')
const before = await readFile(projectJsonPath)
assert.equal(before.byteLength, manifest.originalBytes, 'project.json changed since prepare')
assert.equal(digest(before), manifest.originalSha256, 'project.json hash changed since prepare')

const listBefore = await mcpCall('workcrate_projects_list', { includeArchived: true })
assert.notEqual(listBefore?.isError, true, mcpText(listBefore) ?? 'WorkCrate list must be available before over-limit read')
const listedBefore = JSON.parse(mcpText(listBefore) ?? '[]')
assert.ok(listedBefore.some((entry) => entry.id === manifest.projectId), 'fixture project missing from index')

// Simulate an externally grown but still valid JSON document using legal trailing whitespace.
const fillerLength = MAX_PROJECT_DOCUMENT_BYTES + 1 - before.byteLength
assert.ok(fillerLength > 0)
const oversized = Buffer.concat([before, Buffer.alloc(fillerLength, 0x20)])
assert.ok(oversized.byteLength > MAX_PROJECT_DOCUMENT_BYTES)
assert.deepEqual(JSON.parse(oversized.toString('utf8')).projectId, manifest.projectId)
await writeFile(projectJsonPath, oversized)
const oversizedHash = digest(oversized)

const getResult = await mcpCall('workcrate_project_get', { projectId: manifest.projectId })
assert.equal(getResult?.isError, true, 'workcrate_project_get must reject over-limit project.json')
assert.match(mcpText(getResult) ?? '', /16 MiB|超过/, 'over-limit rejection should explain the size boundary')

const listAfter = await mcpCall('workcrate_projects_list', { includeArchived: true })
assert.notEqual(listAfter?.isError, true, mcpText(listAfter) ?? 'WorkCrate list should remain usable after rejecting a document')
const listedAfter = JSON.parse(mcpText(listAfter) ?? '[]')
assert.ok(listedAfter.some((entry) => entry.id === manifest.projectId), 'project index should remain readable after document rejection')
await writeWindowScreenshot()

const after = await readFile(projectJsonPath)
assert.equal(after.byteLength, oversized.byteLength, 'read rejection must leave oversized project.json unchanged')
assert.equal(digest(after), oversizedHash, 'read rejection must leave oversized project.json hash unchanged')
const report = {
  status: 'passed', projectId: manifest.projectId, projectJsonPath,
  originalBytes: before.byteLength, oversizedBytes: oversized.byteLength,
  oversizedSha256: oversizedHash, returnedError: mcpText(getResult),
  projectListStillAvailable: true, screenshotPath, checkedAt: new Date().toISOString()
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
