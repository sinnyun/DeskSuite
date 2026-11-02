#!/usr/bin/env node
// 用法：node scripts/verify/updater-release.mjs [--exe <路径>] [--cdp-port 9334] [--mcp-port 9701] [--feed https://github.com/sinnyun/DeskSuite] [--download]
// 前置：npx electron-vite build && npx electron-builder --win nsis --publish never --config electron-builder.config.cjs
// 验证打包版自动更新链路（全部经 MCP）：
//   1) updater_get：packaged=true、当前版本
//   2) updater_set_feed：写入 GitHub 仓库地址并持久化
//   3) updater_check：真实访问 GitHub Releases 的 latest.yml，轮询状态至收敛；
//      与远端同版本断言 unavailable，远端有新版本断言 available
//   4) --download：发现新版本时继续 updater_download，断言收敛到 downloaded
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureOutDir, outDir, parseFlags, projectRoot } from './common.mjs'

const { flags } = parseFlags(process.argv.slice(2))
const cdpPort = Number(flags['cdp-port'] || 9334)
const mcpPort = Number(flags['mcp-port'] || 9701)
const feed = String(flags.feed || 'https://github.com/sinnyun/DeskSuite')
const wantDownload = flags.download === true
const exe = resolve(projectRoot, flags.exe || join('release', 'win-unpacked', 'DeskSuite.exe'))
const dataDir = join(dirname(exe), 'data')
const logFile = join(outDir, 'updater-release.log')
const reportFile = join(outDir, 'updater-release.json')

ensureOutDir()

if (!existsSync(exe)) {
  console.error(`找不到打包产物：${exe}\n先运行 npx electron-vite build && npx electron-builder --win nsis --publish never --config electron-builder.config.cjs`)
  process.exit(1)
}

rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
  window: { width: 1600, height: 1000 },
  mcp: { port: mcpPort, access: 'full', writeRoots: [join(projectRoot, 'artifacts', 'verify', 'samples')] }
}, null, 2))

function launch() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const logFd = openSync(logFile, 'a')
  const child = spawn(exe, [`--remote-debugging-port=${cdpPort}`], {
    cwd: dirname(exe),
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  })
  child.unref()
  closeSync(logFd)
  return child.pid
}

function processAlive(pid) {
  const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { shell: true })
  return result.status === 0 && String(result.stdout || '').includes(String(pid))
}

async function waitForCdp(pid) {
  const startedAt = Date.now()
  const deadline = startedAt + 30_000
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      if (list.some((item) => item.type === 'page')) return
    } catch {
      // 端口尚未就绪
    }
    if (Date.now() - startedAt > 3000 && !processAlive(pid)) {
      throw new Error(`打包版进程已退出，查看日志：${logFile}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`30 秒内 CDP 端口 ${cdpPort} 未就绪，查看日志：${logFile}`)
}

function stop(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else try { process.kill(-pid) } catch { /* 已退出 */ }
  return new Promise((r) => setTimeout(r, 1500))
}

const mcpUrl = `http://127.0.0.1:${mcpPort}/mcp`

// common.mjs 的 mcpUrl 在模块加载时求值，而 flags 在加载后才可知；这里内联 MCP 调用直连播种端口
async function mcpRpc(method, params, notify = false) {
  const body = { jsonrpc: '2.0', method, params }
  if (!notify) body.id = 1
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body)
  })
  if (notify) {
    await res.text()
    return null
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 300)}`)
  const data = JSON.parse(text)
  if (data.error) throw new Error(`${method} -> ${JSON.stringify(data.error)}`)
  return data.result
}

async function mcpTool(name, args = {}) {
  const result = await mcpRpc('tools/call', { name, arguments: args })
  if (result.isError) throw new Error(`${name} -> ${JSON.stringify(result.content?.[0]?.text || result)}`)
  return JSON.parse(result.content?.find((item) => item.type === 'text')?.text || '{}')
}

async function pollStatus(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let state
  while (Date.now() < deadline) {
    state = await mcpTool('updater_get')
    if (state.status !== 'checking' && state.status !== 'downloading') return state
    if (!processAlive(pid)) throw new Error('打包版进程在轮询期间退出')
    await new Promise((r) => setTimeout(r, 500))
  }
  return state
}

const pid = launch()
const tools = []
let initial
let afterSetFeed
let finalState
let screenshot = null
try {
  await waitForCdp(pid)

  const dataDeadline = Date.now() + 15_000
  while (!existsSync(join(dataDir, 'data'))) {
    if (Date.now() > dataDeadline) throw new Error(`StoreService 未在 ${join(dataDir, 'data')} 创建目录，查看日志：${logFile}`)
    await new Promise((r) => setTimeout(r, 300))
  }

  await mcpRpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'desksuite-verify', version: '0' }
  })
  await mcpRpc('notifications/initialized', {}, true)
  // workcrate 等插件的 apply 是异步的，tools/list 需要轮询到目标工具全部注册
  const required = ['updater_get', 'updater_set_feed', 'updater_check', 'updater_download', 'updater_install']
  const toolsDeadline = Date.now() + 20_000
  for (;;) {
    const list = await mcpRpc('tools/list', {})
    tools.length = 0
    for (const tool of list.tools || []) tools.push(tool.name)
    if (required.every((name) => tools.includes(name))) break
    if (Date.now() > toolsDeadline) throw new Error(`MCP 工具未注册齐：缺 ${required.filter((name) => !tools.includes(name)).join(', ')}`)
    await new Promise((r) => setTimeout(r, 400))
  }

  initial = await mcpTool('updater_get')
  if (initial.packaged !== true) throw new Error(`updater_get.packaged 应为 true，实际 ${initial.packaged}`)

  afterSetFeed = await mcpTool('updater_set_feed', { feedUrl: feed })
  if (afterSetFeed.feedUrl !== feed) throw new Error(`更新源未持久化：${afterSetFeed.feedUrl}`)

  await mcpTool('updater_check')
  finalState = await pollStatus(30_000)

  if (finalState.status === 'unavailable') {
    if (finalState.availableVersion !== undefined) throw new Error(`unavailable 状态不应携带 availableVersion：${finalState.availableVersion}`)
    if (finalState.message !== '当前已是最新版本') throw new Error(`unexpected message: ${finalState.message}`)
  } else if (finalState.status === 'available') {
    if (!finalState.availableVersion) throw new Error('available 状态缺少 availableVersion')
    if (wantDownload) {
      await mcpTool('updater_download')
      const downloaded = await pollStatus(600_000)
      if (downloaded.status !== 'downloaded') throw new Error(`下载未收敛到 downloaded：${downloaded.status} ${downloaded.message || ''}`)
      finalState = downloaded
    }
  } else {
    throw new Error(`更新检查未收敛：${finalState.status} ${finalState.message || ''}`)
  }

  try {
    const shot = await mcpRpc('tools/call', { name: 'capture_window', arguments: {} })
    const image = shot.content?.find((item) => item.type === 'image')
    if (image?.data) {
      writeFileSync(join(outDir, 'updater-release.png'), Buffer.from(image.data, 'base64'))
      screenshot = 'updater-release.png'
    } else {
      screenshot = 'none'
    }
  } catch { screenshot = 'failed' }
} finally {
  await stop(pid)
}

const report = {
  ok: true,
  exe,
  feed,
  currentVersion: initial.currentVersion,
  finalStatus: finalState.status,
  availableVersion: finalState.availableVersion ?? null,
  message: finalState.message ?? null,
  mcpTools: tools.length,
  screenshot
}
writeFileSync(reportFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
