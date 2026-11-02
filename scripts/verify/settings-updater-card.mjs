#!/usr/bin/env node
// 用法：node scripts/verify/settings-updater-card.mjs [--exe <路径>] [--cdp-port 9338] [--mcp-port 9705] [--feed https://github.com/sinnyun/DeskSuite]
// 前置：npx electron-vite build && npx electron-builder --win nsis --publish never --config electron-builder.config.cjs
// 验收设置 → 运行环境页的「应用更新」卡片（MCP 驱动状态变更，CDP 只读断言 DOM）：
//   1) 卡片渲染：应用更新标题、当前版本字段、获取更新按钮可用（打包版 + 已配置更新源）
//   2) MCP updater_set_feed 后按钮从禁用变可用
//   3) MCP updater_check 收敛 unavailable 后提示「当前已是最新版本」且无下载/安装按钮
//   4) capture_window 截图留证
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureOutDir, outDir, parseFlags, projectRoot } from './common.mjs'

const { flags } = parseFlags(process.argv.slice(2))
const cdpPort = Number(flags['cdp-port'] || 9338)
const mcpPort = Number(flags['mcp-port'] || 9705)
const feed = String(flags.feed || 'https://github.com/sinnyun/DeskSuite')
const exe = resolve(projectRoot, flags.exe || join('release', 'win-unpacked', 'DeskSuite.exe'))
const dataDir = join(dirname(exe), 'data')
const logFile = join(outDir, 'settings-updater-card.log')

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

async function connectCdpEvaluate(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = list.find((item) => item.type === 'page')
  if (!target) throw new Error(`CDP 端口 ${port} 上没有页面目标`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true })
    ws.addEventListener('error', rejectOpen, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = message.id ? pending.get(message.id) : undefined
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  return async (expression) => {
    const result = await new Promise((resolveEval, rejectEval) => {
      const id = ++nextId
      pending.set(id, { resolve: resolveEval, reject: rejectEval })
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      throw new Error(details.exception?.description || details.text)
    }
    return result.result?.value
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(`断言失败：${message}`)
}

const pid = launch()
const checks = {}
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
  const toolsDeadline = Date.now() + 20_000
  for (;;) {
    const list = await mcpRpc('tools/list', {})
    const names = (list.tools || []).map((tool) => tool.name)
    if (['updater_get', 'updater_set_feed', 'updater_check', 'open_settings_page', 'capture_window'].every((name) => names.includes(name))) break
    if (Date.now() > toolsDeadline) throw new Error('MCP 工具未注册齐')
    await new Promise((r) => setTimeout(r, 400))
  }

  const evaluate = await connectCdpEvaluate(cdpPort)

  const cardText = () => evaluate(`(() => {
    const headings = [...document.querySelectorAll('h3')]
    const card = headings.find((h) => h.textContent === '应用更新')?.parentElement
    if (!card) return null
    const text = card.textContent
    const buttons = [...card.querySelectorAll('button')].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled }))
    return { text: text.slice(0, 400), buttons }
  })()`)

  const waitCard = async (deadlineMs = 20_000) => {
    const deadline = Date.now() + deadlineMs
    let lastOpen = 0
    for (;;) {
      const card = await cardText()
      if (card) return card
      // 冷启动时渲染层可能尚未挂载 settings:open 监听，广播会丢失；重发是幂等的
      if (Date.now() - lastOpen > 2_000) {
        lastOpen = Date.now()
        await mcpRpc('tools/call', { name: 'open_settings_page', arguments: { page: 'runtime' } })
      }
      if (Date.now() > deadline) throw new Error('运行环境页未出现「应用更新」卡片')
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const before = await waitCard()
  assert(before.buttons.some((b) => b.label === '获取更新'), '卡片缺少「获取更新」按钮')
  assert(before.buttons.find((b) => b.label === '获取更新')?.disabled === true, '未配置更新源时「获取更新」应禁用')
  assert(!before.buttons.some((b) => b.label === '下载更新' || b.label === '安装更新'), '空闲状态不应出现下载/安装按钮')
  checks.rendered = true

  const state = await mcpTool('updater_set_feed', { feedUrl: feed })
  assert(state.feedUrl === feed, `更新源未持久化：${state.feedUrl}`)
  const feedDeadline = Date.now() + 5_000
  let afterFeed
  for (;;) {
    afterFeed = await cardText()
    if (afterFeed?.buttons.find((b) => b.label === '获取更新')?.disabled === false) break
    if (Date.now() > feedDeadline) throw new Error('配置更新源后「获取更新」仍不可用')
    await new Promise((r) => setTimeout(r, 300))
  }
  checks.feedEnabled = true

  await mcpTool('updater_check')
  const deadline = Date.now() + 60_000
  let finalState
  while (Date.now() < deadline) {
    finalState = await mcpTool('updater_get')
    if (finalState.status !== 'checking') break
    await new Promise((r) => setTimeout(r, 500))
  }
  assert(finalState.status === 'unavailable', `同版本检查应收敛 unavailable，实际 ${finalState.status}`)
  const checkDeadline = Date.now() + 8_000
  let afterCheck
  for (;;) {
    afterCheck = await cardText()
    if (afterCheck?.text.includes('当前已是最新版本')) break
    if (Date.now() > checkDeadline) throw new Error(`卡片提示未显示已是最新：${afterCheck?.text.slice(0, 120)}`)
    await new Promise((r) => setTimeout(r, 300))
  }
  assert(!afterCheck.buttons.some((b) => b.label === '下载更新' || b.label === '安装更新'), 'unavailable 状态不应出现下载/安装按钮')
  checks.checkConverged = true

  const shot = await mcpRpc('tools/call', { name: 'capture_window', arguments: {} })
  const image = shot.content?.find((item) => item.type === 'image')
  if (image?.data) {
    writeFileSync(join(outDir, 'settings-updater-card.png'), Buffer.from(image.data, 'base64'))
    screenshot = 'settings-updater-card.png'
  }
} finally {
  await stop(pid)
}

const report = { ok: true, exe, feed, ...checks, screenshot }
writeFileSync(join(outDir, 'settings-updater-card.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
