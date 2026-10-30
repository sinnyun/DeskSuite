#!/usr/bin/env node
// 用法：node scripts/verify/capture.mjs [--screen] [--window <id>] [--out <png 路径>]
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, parseFlags } from './common.mjs'

const { flags } = parseFlags(process.argv.slice(2))
const screen = flags.screen === true
const name = screen ? 'screen.png' : 'window.png'
const file = flags.out || join(ensureOutDir(), name)

await mcpHandshake()
const args = {}
if (flags.window) args.windowId = Number(flags.window)
const result = await mcpCall(screen ? 'capture_screen' : 'capture_window', args)
const image = mcpImage(result)
if (!image) {
  console.error(mcpText(result) ?? JSON.stringify(result, null, 2))
  process.exit(1)
}

writeFileSync(file, Buffer.from(image.data, 'base64'))
console.log(JSON.stringify({ file, mimeType: image.mimeType, bytes: Buffer.byteLength(image.data, 'base64') }, null, 2))
