#!/usr/bin/env node
// 用法：node scripts/verify/launch.mjs [--build] [--port 9222]
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureOutDir, outDir, parseFlags, pidFile, projectRoot } from './common.mjs'

const { flags } = parseFlags(process.argv.slice(2))
const port = Number(flags.port || process.env.DESKSUITE_CDP_PORT || 9222)

ensureOutDir()

if (flags.build) {
  const build = spawnSync('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'inherit', shell: true })
  if (build.status !== 0) {
    console.error(`构建失败，退出码 ${build.status}`)
    process.exit(build.status ?? 1)
  }
}

const electronPath = createRequire(import.meta.url)('electron')
const logFile = join(outDir, 'electron.log')
const logFd = openSync(logFile, 'a')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronArgs = [`--remote-debugging-port=${port}`]
// Keep MCP screenshots current when another application covers the test window.
if (flags.unthrottled) electronArgs.push('--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding')
if (typeof flags.profile === 'string') {
  const insideVerifyDir = (candidate) => {
    const rel = relative(outDir, candidate)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  }
  const profile = resolve(projectRoot, flags.profile)
  if (!insideVerifyDir(profile)) throw new Error('--profile must be inside artifacts/verify')
  const access = flags.access || 'read'
  if (!['off', 'read', 'standard', 'full'].includes(access)) throw new Error('--access must be off, read, standard, or full')
  const writeRoot = typeof flags['write-root'] === 'string' ? resolve(projectRoot, flags['write-root']) : null
  if (writeRoot && !insideVerifyDir(writeRoot)) throw new Error('--write-root must be inside artifacts/verify')
  const mcpPort = Number(flags['mcp-port'] || 9600)
  if (!Number.isInteger(mcpPort) || mcpPort < 1 || mcpPort > 65535) throw new Error('--mcp-port must be between 1 and 65535')
  mkdirSync(profile, { recursive: true })
  const configPath = join(profile, 'config.json')
  if (flags['preserve-config']) {
    if (!existsSync(configPath)) throw new Error('--preserve-config requires an existing profile config.json')
  } else {
    writeFileSync(configPath, JSON.stringify({
      window: { width: 1600, height: 1000 },
      mcp: { port: mcpPort, access, writeRoots: writeRoot ? [writeRoot] : [] }
    }, null, 2))
  }
  electronArgs.push(`--user-data-dir=${profile}`)
}
electronArgs.push('.')

const child = spawn(electronPath, electronArgs, {
  cwd: projectRoot,
  env,
  detached: true,
  stdio: ['ignore', logFd, logFd]
})
child.unref()
closeSync(logFd)
writeFileSync(pidFile, String(child.pid))

const deadline = Date.now() + 30_000
let target
while (Date.now() < deadline) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find((item) => item.type === 'page')
    if (target) break
  } catch {
    // 端口尚未就绪，继续轮询
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

if (!target) {
  console.error(`Electron 已启动（pid ${child.pid}），但 30 秒内 CDP 端口 ${port} 未就绪，查看日志：${logFile}`)
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      pid: child.pid,
      cdpPort: port,
      url: target.url,
      log: logFile,
      stop: 'node scripts/verify/stop.mjs'
    },
    null,
    2
  )
)
