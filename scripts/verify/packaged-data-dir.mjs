#!/usr/bin/env node
// 用法：node scripts/verify/packaged-data-dir.mjs [--exe <路径>] [--cdp-port 9333] [--mcp-port 9700]
// 前置：npx electron-vite build && npx electron-builder --win nsis --publish never --config electron-builder.config.cjs
// 验证安装版/打包版把 userData 固定在安装目录 data 文件夹：
//   1) 播种测试端口的 config.json 后启动，StoreService 必须在 <安装目录>/data/data 创建目录
//   2) MCP 服务必须使用播种的端口，即 config.json 确实从安装目录读取
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureOutDir, outDir, parseFlags, projectRoot } from './common.mjs'

const { flags } = parseFlags(process.argv.slice(2))
const cdpPort = Number(flags['cdp-port'] || 9333)
const mcpPort = Number(flags['mcp-port'] || 9700)
const exe = resolve(projectRoot, flags.exe || join('release', 'win-unpacked', 'DeskSuite.exe'))
const dataDir = join(dirname(exe), 'data')
const logFile = join(outDir, 'packaged-data-dir.log')

ensureOutDir()

if (!existsSync(exe)) {
  console.error(`找不到打包产物：${exe}\n先运行 npx electron-vite build && npx electron-builder --win nsis --publish never --config electron-builder.config.cjs`)
  process.exit(1)
}

// 上一轮本脚本留下的测试数据（release/ 是构建产物，可随时重建）
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

function processAlive(pid) {
  const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { shell: true })
  return result.status === 0 && String(result.stdout || '').includes(String(pid))
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

const pid = launch()
let tools = []
try {
  await waitForCdp(pid)

  const deadline = Date.now() + 15_000
  while (!existsSync(join(dataDir, 'data'))) {
    if (Date.now() > deadline) throw new Error(`StoreService 未在 ${join(dataDir, 'data')} 创建目录，userData 重定向未生效，查看日志：${logFile}`)
    await new Promise((r) => setTimeout(r, 300))
  }

  await mcpRpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'desksuite-verify', version: '0' }
  })
  await mcpRpc('notifications/initialized', {}, true)
  const list = await mcpRpc('tools/list', {})
  tools = (list.tools || []).map((tool) => tool.name)
  if (!tools.includes('get_app_info')) throw new Error(`MCP 工具列表异常：${tools.slice(0, 5).join(', ')}…`)
} finally {
  await stop(pid)
}

console.log(JSON.stringify({ ok: true, exe, dataDir, cdpPort, mcpPort, tools: tools.length }, null, 2))
