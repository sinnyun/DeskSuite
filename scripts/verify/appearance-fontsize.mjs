#!/usr/bin/env node
// 外观层级字号验收：通过 DeskSuite MCP 修改设置，再用 CDP 只读检查 DOM 变量，并截图确认。
// 用法：node scripts/verify/appearance-fontsize.mjs
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

const ROLE_VARIABLES = {
  pageTitle: '--ds-type-page-title',
  panelTitle: '--ds-type-panel-title',
  title: '--ds-type-title',
  sectionTitle: '--ds-type-section-title',
  body: '--ds-type-body',
  label: '--ds-type-label',
  data: '--ds-type-data'
}

const DEFAULTS = { pageTitle: 24, panelTitle: 20, title: 18, sectionTitle: 16, body: 14, label: 13, data: 12 }
const CUSTOM = { pageTitle: 32, panelTitle: 26, title: 22, sectionTitle: 19, body: 17, label: 15, data: 13 }

const readExpression = `(async () => {
  const computed = getComputedStyle(document.documentElement)
  const vars = ${JSON.stringify(ROLE_VARIABLES)}
  const sizes = {}
  for (const [key, variable] of Object.entries(vars)) sizes[key] = Number.parseFloat(computed.getPropertyValue(variable))
  const heading = document.querySelector('h1, [data-ds-type="page-title"]')
  const texts = [...new Set([...document.querySelectorAll('label, span')].map((element) => element.textContent?.trim() ?? ''))]
  return {
    sizes,
    bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
    headingFontSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : null,
    fieldLabels: texts.filter((text) => text.includes('字号')),
    defaultHints: texts.map((text) => /默认\\s*(\\d+)\\s*px/.exec(text)?.[1]).filter(Boolean),
    buttons: [...document.querySelectorAll('button')].map((element) => element.textContent?.trim() ?? '')
  }
})()`

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))

async function readDom(cdp) {
  return cdp.evaluate(readExpression)
}

async function waitForDom(cdp, isReady, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  let snapshot = await readDom(cdp)
  while (!isReady(snapshot) && Date.now() < deadline) {
    await settle(200)
    snapshot = await readDom(cdp)
  }
  return snapshot
}

async function setFontSize(fontSize) {
  return mcpText(await mcpCall('set_appearance', { fontSize }))
}

const report = { createdAt: new Date().toISOString(), steps: [] }
ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
try {
  await setFontSize(DEFAULTS)
  await settle()
  const baseline = await readDom(cdp)
  report.steps.push({ name: 'defaults', dom: baseline, ok: baseline.bodyFontSize === DEFAULTS.body && baseline.sizes.pageTitle === DEFAULTS.pageTitle })

  await setFontSize(CUSTOM)
  await settle()
  const custom = await readDom(cdp)
  const mismatched = Object.entries(CUSTOM).filter(([key, value]) => custom.sizes[key] !== value)
  report.steps.push({ name: 'custom', dom: custom, mismatched, ok: mismatched.length === 0 && custom.bodyFontSize === CUSTOM.body })

  await mcpCall('open_settings_page', { namespace: 'appearance' })
  const visibleLabels = ['页面标题字号', '面板标题字号', '内容标题字号', '分区标题字号', '正文字号', '标签字号', '辅助信息/数据字号']
  const expectedHints = Object.values(DEFAULTS).map(String)
  const panel = await waitForDom(cdp, (snapshot) => expectedHints.every((hint) => snapshot.defaultHints.includes(hint)) && visibleLabels.every((label) => snapshot.fieldLabels.some((text) => text.includes(label))) && snapshot.buttons.some((text) => text.includes('更新字体')))
  report.steps.push({
    name: 'settings-page',
    missingLabels: visibleLabels.filter((label) => !panel.fieldLabels.some((text) => text.includes(label))),
    missingHints: expectedHints.filter((hint) => !panel.defaultHints.includes(hint)),
    applyButton: panel.buttons.filter((text) => text.includes('更新字体') || text.includes('保存设置')),
    foundHints: panel.defaultHints,
    ok: panel.defaultHints.length >= expectedHints.length
      && visibleLabels.every((label) => panel.fieldLabels.some((text) => text.includes(label)))
      && panel.buttons.some((text) => text.includes('更新字体'))
  })

  const shot = await mcpCall('capture_window', {})
  const image = mcpImage(shot)
  const shotFile = join(outDir, 'appearance-fontsize-settings.png')
  if (image) writeFileSync(shotFile, Buffer.from(image.data, 'base64'))
  report.screenshot = image ? shotFile : (mcpText(shot) ?? '截图失败')
  report.steps.push({ name: 'screenshot', ok: Boolean(image) })

  await mcpCall('command_run', { id: 'ui.open-panel', params: { panel: 'font-audit' } })
  await settle(900)
  const auditShot = mcpImage(await mcpCall('capture_window', {}))
  const auditFile = join(outDir, 'appearance-fontsize-audit.png')
  if (auditShot) writeFileSync(auditFile, Buffer.from(auditShot.data, 'base64'))
  report.auditScreenshot = auditShot ? auditFile : '字体审查截图失败'
  report.steps.push({ name: 'font-audit-screenshot', ok: Boolean(auditShot) })

  await mcpCall('command_run', { id: 'ui.close-panel', params: {} })
  await setFontSize(DEFAULTS)
  await settle()
  const restored = await readDom(cdp)
  report.steps.push({ name: 'restore-defaults', dom: restored, ok: restored.sizes.pageTitle === DEFAULTS.pageTitle && restored.bodyFontSize === DEFAULTS.body })

  report.ok = report.steps.every((step) => step.ok)
} finally {
  cdp.close()
}

const file = join(outDir, 'appearance-fontsize.json')
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ file, ok: report.ok, steps: report.steps.map(({ name, ok }) => ({ name, ok })) }, null, 2))
if (!report.ok) process.exitCode = 1
