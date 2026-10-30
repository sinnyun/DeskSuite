import { spawnSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const crate = join(root, 'native', 'lore-bridge')
const release = process.argv.includes('--release')
const cargoArgs = ['build', '--manifest-path', join(crate, 'Cargo.toml')]
if (release) cargoArgs.push('--release')

const result = spawnSync('cargo', cargoArgs, { cwd: crate, stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const executable = process.platform === 'win32' ? 'desksuite-lore-bridge.exe' : 'desksuite-lore-bridge'
const profile = release ? 'release' : 'debug'
const source = join(crate, 'target', profile, executable)
const output = join(crate, 'bin', executable)
await mkdir(dirname(output), { recursive: true })
await copyFile(source, output)
console.log(`Lore bridge ready: ${output}`)
