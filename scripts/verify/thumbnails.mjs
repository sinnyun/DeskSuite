#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, outDir, projectRoot } from './common.mjs'

const pathIndex = process.argv.indexOf('--path')
const path = pathIndex >= 0 ? process.argv[pathIndex + 1] : join(projectRoot, 'docs', '20261028-010425.png')
if (!path || path.startsWith('--')) throw new Error('用法：node scripts/verify/thumbnails.mjs [--path <图片/文件绝对路径>]')
const path64 = Buffer.from(path, 'utf8').toString('base64')

const cdp = await connectCdp()
try {
  const first = await cdp.evaluate(`(async () => {
    const started = performance.now();
    const path = new TextDecoder().decode(Uint8Array.from(atob('${path64}'), (char) => char.charCodeAt(0)));
    const result = await window.bridge.invoke('thumbnails', 'get', path, 320);
    return { elapsedMs: performance.now() - started, dataUrl: result.dataUrl };
  })()`)
  const second = await cdp.evaluate(`(async () => {
    const started = performance.now();
    const path = new TextDecoder().decode(Uint8Array.from(atob('${path64}'), (char) => char.charCodeAt(0)));
    const result = await window.bridge.invoke('thumbnails', 'get', path, 320);
    return { elapsedMs: performance.now() - started, dataUrl: result.dataUrl };
  })()`)
  if (!first?.dataUrl?.startsWith('data:image/jpeg;base64,')) throw new Error('缩略图未返回 JPEG data URL')
  if (second?.dataUrl !== first.dataUrl) throw new Error('相同文件的缓存命中结果不一致')
  const report = {
    path,
    mimeType: 'image/jpeg',
    firstRequestMs: Math.round(first.elapsedMs),
    cachedRequestMs: Math.round(second.elapsedMs),
    base64Bytes: first.dataUrl.length,
    capturedAt: new Date().toISOString()
  }
  ensureOutDir()
  const file = join(outDir, 'thumbnails.json')
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ file, ...report }, null, 2))
} finally {
  cdp.close()
}
