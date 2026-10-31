#!/usr/bin/env node
// Explorer preview response decoders: MCP drives navigation/selection; CDP only reads DOM.
import assert from 'node:assert/strict'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

const sampleDir = resolve('artifacts/verify/samples/preview-decoder')
await mkdir(sampleDir, { recursive: true })
const imagePath = join(sampleDir, 'sample.png')
const textPath = join(sampleDir, 'sample.md')
const audioPath = join(sampleDir, 'sample.wav')
await copyFile(resolve('artifacts/verify/samples/file-icons/概念图.png'), imagePath)
await writeFile(textPath, '# Preview decoder\n\nBounded text response.\n', 'utf8')
const sampleRate = 8000
const samples = sampleRate / 2
const wav = Buffer.alloc(44 + samples * 2)
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8)
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
await writeFile(audioPath, wav)

await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [] }

async function call(name, args = {}) {
  const result = await mcpCall(name, args)
  assert.notEqual(result?.isError, true, `${name}: ${mcpText(result)}`)
  return result
}

async function select(path) {
  await call('quick_bookmarks_explorer', { action: 'navigate', path: sampleDir })
  await call('quick_bookmarks_explorer', { action: 'select', paths: [path] })
  await call('command_run', { id: 'ui.open-tab', params: { region: 'right', id: 'inspector' } })
  for (let attempt = 0; attempt < 60; attempt++) {
    const name = await cdp.evaluate("document.querySelector('[data-file-inspector]')?.innerText ?? ''")
    if (name.includes(path.split(/[\\/]/).at(-1))) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`检查器未显示所选文件：${path}`)
}

try {
  await select(imagePath)
  const imagePreview = await cdp.evaluate(`(() => { const image = document.querySelector('[data-file-inspector] img[alt="sample.png"]'); return image ? { src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight } : null })()`)
  assert.ok(imagePreview && imagePreview.src.startsWith('data:image/png;base64,'))
  assert.ok(imagePreview.width > 0 && imagePreview.height > 0)
  report.checks.push('image path/MIME/base64 response passed decoder and produced a loaded image preview')
  const image = mcpImage(await call('capture_window'))
  assert.ok(image?.data)
  ensureOutDir()
  await writeFile(join(outDir, 'preview-decoder.png'), Buffer.from(image.data, 'base64'))

  await select(textPath)
  const text = await cdp.evaluate("document.querySelector('[data-file-inspector] pre')?.innerText ?? ''")
  assert.ok(text.includes('Bounded text response'))
  report.checks.push('text response passed path/content/truncated decoding and rendered')

  await select(audioPath)
  const media = await cdp.evaluate("(() => { const el = document.querySelector('[data-file-inspector] audio'); return el ? { src: el.getAttribute('src'), error: el.error?.code ?? null } : null })()")
  assert.ok(media?.src.startsWith('data:audio/wav;base64,'))
  assert.equal(media.error, null)
  report.checks.push('media response passed path/MIME/data URL decoding and audio element loaded')
} finally {
  cdp.close()
}

report.screenshot = join(outDir, 'preview-decoder.png')
console.log(JSON.stringify(report, null, 2))
