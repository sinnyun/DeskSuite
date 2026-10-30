import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const outDir = process.env.DESKSUITE_VERIFY_DIR || join(projectRoot, 'artifacts', 'verify')
export const cdpPort = Number(process.env.DESKSUITE_CDP_PORT || 9222)
export const mcpUrl = process.env.DESKSUITE_MCP_URL || 'http://127.0.0.1:9600/mcp'
export const pidFile = join(outDir, 'electron.pid')

export function ensureOutDir() {
  mkdirSync(outDir, { recursive: true })
  return outDir
}

export function parseFlags(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      rest.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true
    } else {
      flags[key] = next
      i += 1
    }
  }
  return { flags, rest }
}

export async function connectCdp({ onEvent } = {}) {
  const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
  const target = list.find((item) => item.type === 'page')
  if (!target) throw new Error(`CDP 端口 ${cdpPort} 上没有页面目标，请先运行 launch.mjs`)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let nextId = 0
  const pending = new Map()

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = message.id ? pending.get(message.id) : undefined
    if (entry) {
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
      else entry.resolve(message.result)
      return
    }
    onEvent?.(message)
  })

  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true })
    ws.addEventListener('error', rejectOpen, { once: true })
  })

  const send = (method, params = {}) =>
    new Promise((resolveSend, rejectSend) => {
      const id = ++nextId
      pending.set(id, { resolve: resolveSend, reject: rejectSend })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      throw new Error(details.exception?.description || details.text)
    }
    return result.result?.value
  }

  return { send, evaluate, close: () => ws.close(), target }
}

let rpcId = 0

export async function mcpRpc(method, params, { notify = false } = {}) {
  const body = { jsonrpc: '2.0', method, params }
  if (!notify) body.id = ++rpcId
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body)
  })
  if (notify) return null
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 300)}`)
  const data = JSON.parse(text)
  if (data.error) throw new Error(`${method} -> ${JSON.stringify(data.error)}`)
  return data.result
}

export async function mcpHandshake() {
  const init = await mcpRpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'desksuite-verify', version: '0' }
  })
  await mcpRpc('notifications/initialized', {}, { notify: true })
  return init
}

export async function mcpCall(name, args = {}) {
  return mcpRpc('tools/call', { name, arguments: args })
}

export function mcpText(result) {
  return result?.content?.find((item) => item.type === 'text')?.text
}

export function mcpImage(result) {
  return result?.content?.find((item) => item.type === 'image')
}
