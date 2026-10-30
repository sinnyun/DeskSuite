#!/usr/bin/env node
// 用法：node scripts/verify/mcp.mjs tools
//       node scripts/verify/mcp.mjs call <工具名> '<JSON 参数>'
//       node scripts/verify/mcp.mjs smoke
import { readFileSync } from 'node:fs'
import { mcpCall, mcpHandshake, mcpRpc, mcpText, projectRoot } from './common.mjs'

const [command, ...rest] = process.argv.slice(2)

if (command === 'tools') {
  const init = await mcpHandshake()
  const tools = await mcpRpc('tools/list', {})
  console.log(
    JSON.stringify(
      {
        server: init?.serverInfo,
        tools: tools?.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description?.split('\n')[0]
        }))
      },
      null,
      2
    )
  )
} else if (command === 'call') {
  const [name, rawArgs] = rest
  if (!name) {
    console.error('用法：node scripts/verify/mcp.mjs call <工具名> \'<JSON 参数>\'')
    process.exit(1)
  }
  const args = rawArgs ? JSON.parse(rawArgs) : JSON.parse(readFileSync(0, 'utf8').trim() || '{}')
  await mcpHandshake()
  const result = await mcpCall(name, args)
  const text = mcpText(result)
  console.log(text ?? JSON.stringify(result, null, 2))
  // Let fetch and socket handles close naturally; forced process.exit can trip libuv
  // assertions on Windows after the response has already been printed.
  process.exitCode = result?.isError ? 1 : 0
} else if (command === 'smoke') {
  const started = Date.now()
  const init = await mcpHandshake()
  const tools = await mcpRpc('tools/list', {})
  const appInfo = await mcpCall('get_app_info')
  const windows = await mcpCall('list_windows')
  const listing = await mcpCall('list_directory', { path: projectRoot })
  const logs = await mcpCall('get_runtime_logs', { limit: 5 })
  console.log(
    JSON.stringify(
      {
        server: init?.serverInfo,
        tools: tools?.tools?.map((tool) => tool.name),
        appInfo: mcpText(appInfo),
        windows: mcpText(windows),
        directory: mcpText(listing)?.split('\n').slice(0, 6).join('\n'),
        logs: mcpText(logs),
        elapsedMs: Date.now() - started
      },
      null,
      2
    )
  )
} else {
  console.error('用法：node scripts/verify/mcp.mjs <tools|call|smoke> ...')
  process.exit(1)
}
