import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const crate = join(root, 'native', 'lore-bridge')
const release = process.argv.includes('--release')
const executable = process.platform === 'win32' ? 'desksuite-lore-bridge.exe' : 'desksuite-lore-bridge'
const output = join(crate, 'bin', executable)

if (process.argv.includes('--if-missing') && existsSync(output)) {
  console.log(`Lore bridge already present, skipping build: ${output}`)
  process.exit(0)
}

const cargoArgs = ['build', '--manifest-path', join(crate, 'Cargo.toml')]
if (release) cargoArgs.push('--release')

const result = spawnSync('cargo', cargoArgs, { cwd: crate, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const profile = release ? 'release' : 'debug'
const source = join(crate, 'target', profile, executable)
await mkdir(dirname(output), { recursive: true })
await copyFile(source, output)
console.log(`Lore bridge ready: ${output}`)
