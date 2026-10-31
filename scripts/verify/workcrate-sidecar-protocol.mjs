import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOutDir } from './common.mjs'
import { decodeRpcLine, encodeRpcRequest, MAX_PROTOCOL_LINE, parseTextResult } from '../../src/main/plugins/project-provider-workcrate-boards/sidecar-protocol.ts'

const output = join(ensureOutDir(), 'workcrate-sidecar-protocol.json')
const checks = []
function check(name, run) {
  run()
  checks.push(name)
}

check('JSON-RPC success envelope', () => assert.deepEqual(decodeRpcLine('{"jsonrpc":"2.0","id":3,"result":{"ok":true}}'), {
  jsonrpc: '2.0', id: 3, result: { ok: true }
}))
check('JSON-RPC error envelope', () => assert.equal(decodeRpcLine('{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"failed","data":1}}').error.message, 'failed'))
check('JSON-RPC notification envelope', () => assert.deepEqual(decodeRpcLine('{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'), {
  jsonrpc: '2.0', method: 'notifications/initialized', params: {}
}))

check('malformed JSON-RPC envelopes rejected', () => {
  for (const line of [
    '{',
    '{"jsonrpc":"1.0","id":1,"result":null}',
    '{"jsonrpc":"2.0","id":1}',
    '{"jsonrpc":"2.0","id":-1,"result":null}',
    '{"jsonrpc":"2.0","id":1,"result":null,"unexpected":true}',
    JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x'.repeat(64 * 1024 + 1) } })
  ]) assert.throws(() => decodeRpcLine(line), /JSON-RPC/)
})

check('MCP tool result decoding and bounds', () => {
  assert.equal(parseTextResult({ content: [{ type: 'text', text: '{"items":2}' }] }).items, 2)
  assert.throws(() => parseTextResult({ content: [] }), /no text result/)
  assert.throws(() => parseTextResult({ content: [{ type: 'text', text: 'not json' }] }), /invalid JSON/)
  assert.throws(() => parseTextResult({ content: Array.from({ length: 101 }, () => ({ type: 'text', text: '{}' })) }), /结构无效/)
  assert.throws(() => parseTextResult({ isError: true, content: [{ type: 'text', text: 'x'.repeat(2049) }] }), (error) => error.message.length === 2048)
})

check('UTF-8 line budget enforced in both directions', () => {
  assert.equal(encodeRpcRequest(1, 'tools/list', {}).endsWith('\n'), true)
  assert.throws(() => encodeRpcRequest(1, 'tools/call', { data: '界'.repeat(Math.ceil(MAX_PROTOCOL_LINE / 3)) }), /64 MiB/)
  assert.throws(() => decodeRpcLine(' '.repeat(MAX_PROTOCOL_LINE + 1)), /64 MiB/)
})

writeFileSync(output, `${JSON.stringify({ status: 'passed', checks, capturedAt: new Date().toISOString() }, null, 2)}\n`)
console.log('WorkCrate sidecar protocol decoder and resource boundaries OK')
console.log(`Report: ${output}`)
