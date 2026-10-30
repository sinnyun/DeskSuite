#!/usr/bin/env node
// Measure isolated catalog injection and renderer scrolling without adding filesystem fixtures.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, outDir } from './common.mjs'

const countsArg = process.argv.find((value) => value.startsWith('--counts='))?.slice('--counts='.length)
const counts = (countsArg ?? '1000,10000,100000').split(',').map(Number)
if (counts.some((count) => !Number.isSafeInteger(count) || count < 1 || count > 200000)) {
  throw new Error('--counts 只接受 1 至 200000 之间的整数')
}

await mcpHandshake()
const profile = `perf-${Date.now()}`
const cdp = await connectCdp()
const originalAccess = await cdp.evaluate("window.bridge.invoke('mcp', 'getAccess')")
const results = []

async function devCall(name, args) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(mcpText(result) ?? `${name} 失败`)
  return JSON.parse(mcpText(result) ?? '{}')
}

async function waitForJob() {
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    const status = await devCall('dev_status', { profile })
    if (!status.runningJobId) return status
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('性能注入任务等待超时')
}

try {
  await cdp.evaluate("window.bridge.invoke('mcp', 'setAccess', 'standard')")
  for (const count of counts) {
    const started = Date.now()
    await devCall('dev_inject_data', { count, profile })
    const status = await waitForJob()
    const injectionMs = Date.now() - started
    const search = await cdp.evaluate(`(async () => {
      const start = performance.now();
      const result = await window.bridge.invoke('search', 'query', { query: 'synthetic', limit: 200 });
      return { elapsedMs: performance.now() - start, resultCount: result.total, sampleCount: result.items.length };
    })()`)
    const renderer = await cdp.evaluate(`(async () => {
      const started = performance.now();
      const button = [...document.querySelectorAll('button')].find((node) => node.title === '搜索已扫描文件');
      button?.click();
      const deadline = Date.now() + 5000;
      let input;
      while (Date.now() < deadline && !input) {
        input = [...document.querySelectorAll('input')].find((node) => node.placeholder === '搜索已扫描的名称或路径…');
        if (!input) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!input) return null;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'synthetic');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      let list;
      while (Date.now() < deadline) {
        list = [...document.querySelectorAll('ul')].find((node) => node.innerText.includes('synthetic-'));
        if (list) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!list) return null;
      const scroll = list.parentElement;
      window.__desksuitePerfScroll = scroll;
      const visibleRows = [...list.children].filter((node) => {
        const rect = node.getBoundingClientRect();
        const viewport = scroll.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      }).length;
      return { firstPageResultsMs: performance.now() - started, visibleRows,
        scrollHeight: scroll.scrollHeight, scrollClientHeight: scroll.clientHeight,
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
        firstContentPaintMs: performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? null };
    })()`)
    const fps = await cdp.evaluate(`(async () => {
      const node = window.__desksuitePerfScroll;
      if (!node) return null;
      const start = performance.now(); let frames = 0; let delta = 8;
      return await new Promise((resolve) => {
        const tick = (now) => {
          frames += 1; node.scrollTop += delta;
          if (node.scrollTop <= 0 || node.scrollTop + node.clientHeight >= node.scrollHeight) delta *= -1;
          if (now - start >= 1000) resolve(Math.round(frames * 1000 / (now - start))); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    })()`)
    results.push({ count, indexedRows: status.rows, injectionMs, searchMs: Math.round(search?.elapsedMs ?? 0), searchResults: search?.resultCount ?? 0,
      searchSampleCount: search?.sampleCount ?? 0, visibleRows: renderer?.visibleRows ?? null,
      searchFirstPageMs: Math.round(renderer?.firstPageResultsMs ?? 0), scrollFps: fps,
      rendererHeapBytes: renderer?.heapBytes ?? null, firstContentPaintMs: renderer?.firstContentPaintMs ?? null })
  }
} finally {
  await devCall('dev_clear_data', { profile }).catch(() => undefined)
  await waitForJob().catch(() => undefined)
  await cdp.evaluate('delete window.__desksuitePerfScroll').catch(() => {})
  await cdp.evaluate(`window.bridge.invoke('mcp', 'setAccess', ${JSON.stringify(originalAccess)})`).catch(() => {})
  cdp.close()
}

ensureOutDir()
const output = { createdAt: new Date().toISOString(), profile, results }
const file = join(outDir, `perf-${new Date().toISOString().replaceAll(':', '-')}.json`)
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ file, ...output }, null, 2))
