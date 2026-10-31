#!/usr/bin/env node
// Pure decoder/sanitizer verification; does not start DeskSuite or mutate application state.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { boundedPayload, safeLogEntry, safePayload } from '../../src/main/plugins/system-basic-runtime-log/payload.ts'
import { ensureOutDir, outDir } from './common.mjs'

const cycle = { label: 'cycle' }
cycle.self = cycle
const throwingGetter = { available: true }
Object.defineProperty(throwingGetter, 'unstable', {
  enumerable: true,
  get() { throw new Error('getter must not escape sanitizer') }
})
const protoProbe = JSON.parse('{"__proto__":{"polluted":true},"constructor":"kept as data"}')
const mcpToolEvent = {
  name: 'filesystem_preview_image',
  phase: 'end',
  traceId: 'mcp-verify',
  args: {
    signal: new AbortController().signal,
    url: new URL('http://127.0.0.1/mcp'),
    headers: { authorization: 'Bearer secret-probe' },
    callback: () => 'not cloneable'
  },
  result: { content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] }
}

const probe = {
  undefinedValue: undefined,
  functionValue() {},
  symbolValue: Symbol('private'),
  bigintValue: 12345678901234567890n,
  cycle,
  getter: throwingGetter,
  prototypeKeys: protoProbe,
  mcpToolEvent
}
const safe = boundedPayload(probe)
assert.doesNotThrow(() => structuredClone(safe), 'sanitized tool payload must support Electron structured cloning')
assert.doesNotThrow(() => JSON.stringify(safe), 'sanitized tool payload must be JSON serializable')
assert.equal(safe.undefinedValue, '[undefined]')
assert.equal(safe.functionValue, '[函数已省略]')
assert.equal(safe.symbolValue, '[Symbol(private)]')
assert.equal(safe.bigintValue, '12345678901234567890n')
assert.equal(safe.cycle.self, '[循环引用]')
assert.equal(safe.getter.unstable, '[属性无法读取]')
assert.equal(safe.prototypeKeys.__proto__.polluted, true)
assert.equal(Object.getPrototypeOf(safe.prototypeKeys), null, 'untrusted __proto__ key must stay inert data')
assert.equal(safe.mcpToolEvent.args.headers.authorization, '[已脱敏]')
assert.equal(safe.mcpToolEvent.args.callback, '[函数已省略]')
assert.equal(safe.mcpToolEvent.result.content[0].data, 'aGVsbG8=')

const safeEntry = safeLogEntry({
  id: 'main-test', level: 'event', message: 'MCP call', source: 'MCP',
  payload: { text: 'x'.repeat(20_000), details: probe },
  tags: [Symbol('tag')], traceId: undefined
})
assert.doesNotThrow(() => structuredClone(safeEntry), 'the full log entry envelope must support Electron structured cloning')
assert.ok(safeEntry.payload.text.length > 12_000, 'payload text budget remains distinct from the 12K string field budget')
assert.equal(Object.hasOwn(safeEntry, 'traceId'), false, 'undefined optional envelope fields are omitted')

const deep = { value: true }
let nested = deep
for (let index = 0; index < 12; index += 1) nested.child = nested = { child: {} }
const boundedDeep = safePayload(deep)
assert.doesNotThrow(() => structuredClone(boundedDeep))
assert.ok(JSON.stringify(boundedDeep).includes('深度限制'))
const boundedArray = safePayload(Array.from({ length: 130 }, (_, index) => index))
assert.equal(boundedArray.length, 101, 'array cap retains 100 values plus a truncation marker')
const manyKeys = Object.fromEntries(Array.from({ length: 220 }, (_, index) => [`key${index}`, index]))
assert.equal(safePayload(manyKeys).__truncatedKeys, 20)

const oversized = boundedPayload({ data: Array.from({ length: 10 }, () => 'x'.repeat(12_000)) })
assert.equal(oversized.__truncated, true)
assert.ok(JSON.stringify(oversized).length <= 48_000 + 300)
const oversizedEntry = safeLogEntry({ level: 'info', payload: { data: Array.from({ length: 10 }, () => 'x'.repeat(12_000)) } })
assert.doesNotThrow(() => structuredClone(oversizedEntry))
assert.ok(oversizedEntry.payload.__truncated, 'full entry sanitation preserves the existing 48 KB payload cap')

ensureOutDir()
const reportPath = join(outDir, 'runtime-log-payload.json')
await writeFile(reportPath, `${JSON.stringify({
  status: 'passed',
  cases: ['undefined', 'function', 'symbol', 'bigint', 'circular reference', 'throwing getter', '__proto__', 'MCP tool event request context', 'depth/key/array/48KB bounds'],
  structuredClone: true,
  reportPath
}, null, 2)}\n`, 'utf8')
console.log(`Runtime log safe-payload assertions passed; report: ${reportPath}`)
