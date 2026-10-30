#!/usr/bin/env node
// 用法：node scripts/verify/mcp-guard.mjs
// 前置：node scripts/verify/launch.mjs（脚本经 CDP 切换访问级别，经 MCP 断言实际行为）
import { connectCdp, mcpCall, mcpHandshake, mcpText } from './common.mjs'

const ACCESS_LEVELS = ['off', 'read', 'standard', 'full']
const EMPTY_CLIPBOARD = '（剪贴板为空或不是文本）'
// 带时间戳，避免与用户原有剪贴板内容混淆
const MARKER = `desksuite-mcp-guard-${Date.now()}`

const results = []
const check = (label, ok, detail) => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
}

const payloadOf = (result) => {
  const text = mcpText(result)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const levelOf = async (cdp) => cdp.evaluate("window.bridge.invoke('mcp', 'getAccess')")

let cdp
try {
  cdp = await connectCdp()
} catch (error) {
  console.error('无法连接应用（CDP）：请先运行 node scripts/verify/launch.mjs')
  console.error(String(error?.message ?? error))
  process.exit(1)
}

const switchAccess = async (level) => {
  const result = await cdp.evaluate(
    `window.bridge.invoke('mcp', 'setAccess', ${JSON.stringify(level)})`
  )
  if (!result || result.access !== level) {
    throw new Error(`切换访问级别失败：期望 ${level}，得到 ${JSON.stringify(result)}`)
  }
  return result
}

let originalAccess = null
let clipboardBackup = null

try {
  originalAccess = await levelOf(cdp)
  check('读取原始访问级别', ACCESS_LEVELS.includes(originalAccess), originalAccess)

  await mcpHandshake()

  // 原级别为 off 时读不到剪贴板，此时不备份（结束时也就不回填）
  const backup = await mcpCall('read_clipboard')
  if (backup?.isError !== true) {
    const text = mcpText(backup)
    if (text && text !== EMPTY_CLIPBOARD) clipboardBackup = text
  }

  // ---- off：任何工具都被拒绝 ----
  await switchAccess('off')
  check('off：mcp.getAccess 返回 off', (await levelOf(cdp)) === 'off')
  const offResult = await mcpCall('get_app_info')
  const offPayload = payloadOf(offResult)
  check('off：get_app_info 返回 isError', offResult?.isError === true, mcpText(offResult))
  check('off：错误 JSON 的 code 为 forbidden', offPayload?.code === 'forbidden')
  check('off：requiredAccess 为 read', offPayload?.requiredAccess === 'read', offPayload?.requiredAccess)
  check('off：错误里带当前档位 access', offPayload?.access === 'off', offPayload?.access)

  // ---- read：只读放行、写拒绝 ----
  await switchAccess('read')
  check('read：mcp.getAccess 返回 read', (await levelOf(cdp)) === 'read')
  const readResult = await mcpCall('get_app_info')
  check('read：get_app_info 成功', readResult?.isError !== true, mcpText(readResult)?.slice(0, 80))
  const readDenied = await mcpCall('write_clipboard', { text: MARKER })
  const readPayload = payloadOf(readDenied)
  check('read：write_clipboard 被拒绝', readDenied?.isError === true, mcpText(readDenied))
  check('read：错误 JSON 的 code 为 forbidden', readPayload?.code === 'forbidden')
  check('read：requiredAccess 为 standard', readPayload?.requiredAccess === 'standard', readPayload?.requiredAccess)
  const afterDenied = await mcpCall('read_clipboard')
  check('read：被拒的写入未落盘', mcpText(afterDenied) !== MARKER)

  // ---- standard：低影响写放行 ----
  await switchAccess('standard')
  check('standard：mcp.getAccess 返回 standard', (await levelOf(cdp)) === 'standard')
  const writeResult = await mcpCall('write_clipboard', { text: MARKER })
  check('standard：write_clipboard 成功', writeResult?.isError !== true, mcpText(writeResult))
  const echoed = await mcpCall('read_clipboard')
  check('standard：剪贴板内容与写入一致', mcpText(echoed) === MARKER, mcpText(echoed))

  // ---- full：写工具仍放行 ----
  await switchAccess('full')
  check('full：mcp.getAccess 返回 full', (await levelOf(cdp)) === 'full')
  const fullWrite = await mcpCall('write_clipboard', { text: `${MARKER}-full` })
  check('full：write_clipboard 成功', fullWrite?.isError !== true, mcpText(fullWrite))
  const fullEcho = await mcpCall('read_clipboard')
  check('full：剪贴板内容与写入一致', mcpText(fullEcho) === `${MARKER}-full`, mcpText(fullEcho))

  if (clipboardBackup !== null) {
    const restored = await mcpCall('write_clipboard', { text: clipboardBackup })
    check('恢复原剪贴板内容', restored?.isError !== true)
  }
} catch (error) {
  check('脚本执行未抛异常', false, String(error?.message ?? error))
} finally {
  if (originalAccess && ACCESS_LEVELS.includes(originalAccess)) {
    try {
      await switchAccess(originalAccess)
      check(`恢复原访问级别（${originalAccess}）`, (await levelOf(cdp)) === originalAccess)
    } catch (error) {
      check('恢复原访问级别', false, String(error?.message ?? error))
    }
  }
  cdp.close()
}

const failed = results.filter((item) => !item.ok)
console.log(`\n共 ${results.length} 项断言，失败 ${failed.length} 项`)
if (failed.length > 0) {
  for (const item of failed) console.error(`  - ${item.label}`)
  process.exitCode = 1
}
