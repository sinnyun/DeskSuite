import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = []
const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, mcpText(result))
  return JSON.parse(mcpText(result))
}
const readUi = () => cdp.evaluate(`(() => {
  const toggle = document.querySelector('[data-network-drive-toggle]')
  return { pressed: toggle?.getAttribute('aria-pressed'), disabled: toggle?.disabled,
    paths: [...document.querySelectorAll('[data-drive-path]')].map(el => el.dataset.drivePath),
    networkCount: document.querySelectorAll('[data-network-drive="true"]').length,
    toggleWidth: toggle?.getBoundingClientRect().width,
    overflow: document.querySelector('[data-quick-bookmarks]')?.parentElement.scrollWidth > document.querySelector('[data-quick-bookmarks]')?.parentElement.clientWidth }
})()`)
const waitUi = async (show, expectedPaths) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ui = await readUi()
    if (ui.pressed === String(show) && !ui.disabled && JSON.stringify(ui.paths) === JSON.stringify(expectedPaths)) {
      assert.ok(ui.toggleWidth > 10)
      assert.equal(ui.overflow, false)
      return ui
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`UI did not match: ${JSON.stringify(await readUi())}`)
}
const capture = async (name) => {
  await mcpCall('control_window', { action: 'focus' })
  await new Promise(resolve => setTimeout(resolve, 600))
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image)
  await writeFile(join(outDir, name), Buffer.from(image.data, 'base64'))
}
try {
  const drives = await call('list_drives')
  assert.ok(drives.length > 0)
  assert.ok(drives.every(drive => typeof drive.isNetwork === 'boolean'))
  const all = drives.map(drive => drive.path)
  const local = drives.filter(drive => !drive.isNetwork).map(drive => drive.path)
  if (process.argv.includes('--check-restart')) {
    assert.deepEqual(await call('explorer_drive_preferences'), { showNetworkDrives: false })
    report.push({ restart: await waitUi(false, local) })
  } else {
    assert.deepEqual(await call('explorer_drive_preferences'), { showNetworkDrives: true })
    report.push({ default: await waitUi(true, all), networkDrives: drives.filter(drive => drive.isNetwork) })
    await capture('network-drives-visible.png')
    await call('explorer_drive_preferences', { showNetworkDrives: false })
    const hidden = await waitUi(false, local)
    assert.equal(hidden.networkCount, 0)
    report.push({ hidden })
    assert.equal((await call('list_drives')).length, all.length)
    await capture('network-drives-hidden.png')
    await call('explorer_drive_preferences', { showNetworkDrives: true })
    await waitUi(true, all)
    await call('explorer_drive_preferences', { showNetworkDrives: false })
    await waitUi(false, local)
    const invalid = await mcpCall('explorer_drive_preferences', { showNetworkDrives: 'false' })
    assert.equal(invalid.isError, true)
    assert.deepEqual(await call('explorer_drive_preferences'), { showNetworkDrives: false })
    report.push('反复切换、无效输入拒绝、完整驱动器 API 不受显示筛选影响')
  }
  console.log(JSON.stringify({ ok: true, report }, null, 2))
  await writeFile(join(outDir, process.argv.includes('--check-restart') ? 'network-drives-restart.json' : 'network-drives.json'), JSON.stringify({ ok: true, report }, null, 2))
} finally { cdp.close() }
