#!/usr/bin/env node
// 用法：node scripts/verify/stop.mjs [--force]
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { pidFile } from './common.mjs'

if (!existsSync(pidFile)) {
  console.log('没有记录中的 Electron 进程（artifacts/verify/electron.pid 不存在）')
  process.exit(0)
}

const pid = Number(readFileSync(pidFile, 'utf8').trim())
try {
  process.kill(pid)
} catch (error) {
  console.log(`进程 ${pid} 已不存在：${error.message}`)
  rmSync(pidFile, { force: true })
  process.exit(0)
}

const deadline = Date.now() + 10_000
let alive = true
while (alive && Date.now() < deadline) {
  try {
    process.kill(pid, 0)
    await new Promise((resolve) => setTimeout(resolve, 300))
  } catch {
    alive = false
  }
}

if (alive && process.argv.includes('--force')) {
  process.kill(pid, 'SIGKILL')
  alive = false
}

rmSync(pidFile, { force: true })
console.log(alive ? `进程 ${pid} 未在 10 秒内退出，可加 --force` : `已停止 Electron（pid ${pid}）`)
process.exit(alive ? 1 : 0)
