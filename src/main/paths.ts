import { app } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// index.ts 必须把本文件放在第一个 import：app.ts 的插件聚合在模块求值期就会读取
// userData，重定向必须发生在任何读取之前。安装版把持久化数据固定在安装目录的
// data 文件夹（安装/升级/卸载均不覆盖，NSIS 侧保护见 build/installer.nsh）；
// 目录不可写（如装入 Program Files）时回落默认 %APPDATA%。
if (app.isPackaged && !process.argv.some((arg) => arg.startsWith('--user-data-dir'))) {
  const dataRoot = join(dirname(app.getPath('exe')), 'data')
  if (writable(dataRoot)) app.setPath('userData', dataRoot)
}

function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.desksuite-write-probe')
    writeFileSync(probe, '')
    rmSync(probe)
    return true
  } catch {
    return false
  }
}
