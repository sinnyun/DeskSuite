import assert from 'node:assert/strict'
import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

const SAMPLE_NAME = 'index-scan-stale-budget'
const FIXTURE_COUNT = 1_105
const fixtureRoot = resolve(outDir, 'samples', SAMPLE_NAME)
const rootA = join(fixtureRoot, 'root-a')
const rootB = join(fixtureRoot, 'root-b')
const sampleRoot = resolve(outDir, 'samples')
const expectedProfile = resolve(projectRoot, 'artifacts', 'verify', 'profiles', 'index-scan-stale-budget')
const expectedWriteRoot = sampleRoot
const withinSamples = (path) => {
  const rel = relative(sampleRoot, resolve(path))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
const samePath = (left, right) => {
  const a = resolve(left).replace(/[\\/]+$/, '')
  const b = resolve(right).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

assert.ok(withinSamples(fixtureRoot), `Fixture path escaped samples: ${fixtureRoot}`)

async function removeFixtureRoot() {
  try {
    const info = await lstat(fixtureRoot)
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Refusing to remove fixture root that is not an ordinary directory')
    await rm(fixtureRoot, { recursive: true, force: false })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

if (process.argv.includes('--prepare')) {
  ensureOutDir()
  await removeFixtureRoot()
  await mkdir(rootA, { recursive: true })
  await mkdir(rootB, { recursive: true })
  for (let index = 0; index < FIXTURE_COUNT; index += 1) {
    const name = `stale-budget-dir-${String(index).padStart(4, '0')}`
    const dir = join(rootA, name)
    await mkdir(dir)
    await writeFile(join(dir, `stale-budget-file-${String(index).padStart(4, '0')}.dat`), `fixture-${index}\n`, 'utf8')
  }
  await writeFile(join(rootB, 'stale-budget-retained-root-sentinel.txt'), 'other root must remain indexed\n', 'utf8')
  console.log(JSON.stringify({ prepared: true, fixtureRoot, rootA, rootB, fixtureCount: FIXTURE_COUNT }, null, 2))
  process.exit(0)
}

assert.ok(process.argv.includes('--check'), 'Use --prepare or --check')
ensureOutDir()
for (const path of [fixtureRoot, rootA, rootB]) {
  assert.ok(withinSamples(path), `Fixture path escaped samples: ${path}`)
  const info = await lstat(path)
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), `Fixture path is not an ordinary directory: ${path}`)
}
const initialDirs = await readdir(rootA)
assert.equal(initialDirs.length, FIXTURE_COUNT, 'Fixture has unexpected contents; rerun --prepare')

await mcpHandshake()
const call = async (tool, args) => {
  const result = await mcpCall(tool, args)
  assert.notEqual(result?.isError, true, `${tool} failed: ${mcpText(result)}`)
  return result
}
const parseText = (result, label) => {
  const text = mcpText(result)
  assert.ok(text, `${label} returned no text`)
  return JSON.parse(text)
}
const storage = parseText(await call('plugin_storage', {}), 'plugin_storage')
assert.ok(samePath(storage.userData, expectedProfile),
  `Refusing to mutate index outside fixed profile: expected ${expectedProfile}, got ${storage.userData}`)
const mcpConfig = parseText(await call('command_run', {
  id: 'ipc.settings.get', params: { args: ['mcp'] }
}), 'ipc.settings.get(mcp)')
assert.equal(mcpConfig.access, 'full', 'MCP access must be full for the isolated verification instance')
assert.equal(mcpConfig.writeRoots?.length, 1, 'MCP must have exactly one isolated sample write root')
assert.ok(samePath(mcpConfig.writeRoots[0], expectedWriteRoot),
  `Refusing to mutate index with unexpected write roots: ${JSON.stringify(mcpConfig.writeRoots)}`)
const scan = async (roots) => {
  const started = parseText(await call('index_scan', { roots }), 'index_scan')
  assert.ok(typeof started.jobId === 'string' && started.jobId, 'index_scan did not return jobId')
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const status = parseText(await call('get_job_status', { jobId: started.jobId }), 'get_job_status')
    if (status.state === 'done') return status
    if (status.state === 'failed' || status.state === 'canceled') throw new Error(`index_scan ended ${status.state}: ${JSON.stringify(status)}`)
    await new Promise((wait) => setTimeout(wait, 350))
  }
  throw new Error(`index_scan timed out: ${started.jobId}`)
}
const search = async (query, root) => parseText(await call('search_files', { query, root, limit: 1 }), 'search_files')

const first = await scan([rootA, rootB])
assert.equal(first.state, 'done')
assert.equal(first.summary?.staleFilesRemoved, 0)
assert.equal(first.summary?.staleFoldersRemoved, 0)
const firstSearch = await search('stale-budget-file-', rootA)
assert.equal(firstSearch.total, FIXTURE_COUNT, 'First scan did not index all fixture files')
const keepSearch = await search('stale-budget-retained-root-sentinel.txt', rootB)
assert.equal(keepSearch.total, 1, 'Second independent root fixture was not indexed')

for (const entry of initialDirs) {
  assert.match(entry, /^stale-budget-dir-\d{4}$/)
  const target = join(rootA, entry)
  assert.ok(withinSamples(target), `Refusing to remove path outside samples: ${target}`)
  await rm(target, { recursive: true, force: false })
}

const second = await scan([rootA])
assert.equal(second.state, 'done')
assert.equal(second.summary?.staleFilesRemoved, FIXTURE_COUNT, 'Second scan did not remove all stale file rows across batches')
assert.equal(second.summary?.staleFoldersRemoved, FIXTURE_COUNT, 'Second scan did not remove all stale folder rows across batches')
const staleAfter = await search('stale-budget-file-', rootA)
assert.equal(staleAfter.total, 0, 'Stale files remain in the scanned root index')
const keepAfter = await search('stale-budget-retained-root-sentinel.txt', rootB)
assert.equal(keepAfter.total, 1, 'Scanning root-a removed data belonging to root-b')

const screenshot = mcpImage(await call('capture_window', {}))
assert.ok(screenshot?.mimeType === 'image/png', 'capture_window did not return a PNG image block')
const screenshotPath = join(outDir, 'index-scan-stale-budget.png')
await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
const reportPath = join(outDir, 'index-scan-stale-budget.json')
await writeFile(reportPath, `${JSON.stringify({
  status: 'passed', fixtureRoot, profile: storage.userData, mcpConfig, fixtureCount: FIXTURE_COUNT,
  firstScan: first.summary, secondScan: second.summary,
  staleFilesAfterSecondScan: staleAfter.total,
  retainedOtherRootEntries: keepAfter.total,
  screenshotPath, completedAt: new Date().toISOString()
}, null, 2)}\n`, 'utf8')
console.log(`index_scan bounded stale cleanup MCP check passed; report: ${reportPath}; screenshot: ${screenshotPath}`)
