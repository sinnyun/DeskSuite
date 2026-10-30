#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, outDir } from './common.mjs'

const cdp = await connectCdp()
try {
  const result = await cdp.evaluate(`(async () => {
    const settings = await window.bridge.invoke('settings', 'list');
    const commands = await window.bridge.invoke('commands', 'list');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const paletteVisible = Boolean(document.querySelector('[aria-label="搜索命令"]'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { settings: settings.map((item) => item.namespace), commands: commands.map((item) => item.id), paletteVisible };
  })()`)
  const report = {
    createdAt: new Date().toISOString(),
    settings: result?.settings ?? [],
    commands: result?.commands ?? [],
    paletteVisible: result?.paletteVisible === true,
    requiredSettings: ['mcp', 'appearance'],
    requiredCommands: ['system.open-settings', 'system.open-launcher', 'system.open-clipboard', 'system.toggle-theme', 'ui.open-panel']
  }
  report.missingSettings = report.requiredSettings.filter((key) => !report.settings.includes(key))
  report.missingCommands = report.requiredCommands.filter((key) => !report.commands.includes(key))
  report.ok = report.missingSettings.length === 0 && report.missingCommands.length === 0 && report.paletteVisible
  ensureOutDir()
  const file = join(outDir, 'settings-commands.json')
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ file, ...report }, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  cdp.close()
}
