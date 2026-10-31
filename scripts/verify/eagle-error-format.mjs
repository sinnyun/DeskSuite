#!/usr/bin/env node
// Exercises the production Eagle API client against injected HTTP responses; no listener or Eagle process is started.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { ensureOutDir, outDir, projectRoot } from './common.mjs'

ensureOutDir()
const baseRequire = createRequire(join(projectRoot, 'package.json'))
const compile = (path) => ts.transpileModule(path, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const context = vm.createContext({
  Buffer, URL, AbortSignal, AbortController, process
})
const evaluate = (source, requireModule) => {
  const module = { exports: {} }
  const wrapper = vm.runInContext(`(function (exports, require, module) { ${source}\n})`, context)
  wrapper(module.exports, requireModule, module)
  return module.exports
}
const helperSource = await readFile(join(projectRoot, 'src/main/services/error-text.ts'), 'utf8')
const helpers = evaluate(compile(helperSource), baseRequire)
const eagleSource = await readFile(join(projectRoot, 'src/main/plugins/data-provider-eagle-links/eagle.ts'), 'utf8')
const eagle = evaluate(compile(eagleSource), (id) => id === '../../services/error-text' ? helpers : baseRequire(id))

const runFailure = async (message) => {
  const client = new eagle.EagleClient(async () => new Response(JSON.stringify({ status: 'error', data: null, message })))
  try {
    await client.resolve('TEST1')
    assert.fail('Eagle API failure response must reject')
  } catch (error) {
    assert.equal(typeof error?.message, 'string')
    assert.ok(error.message.startsWith('Eagle 查询失败'))
    assert.ok(error.message.length <= 2000, `error length was ${error.message.length}`)
    return error.message
  } finally {
    client.dispose()
  }
}

const privateDetail = await runFailure('token=secret-value C:\\Users\\alice\\private.txt')
assert.ok(privateDetail.includes('token=[已脱敏]'))
assert.ok(privateDetail.includes('[本机路径]'))
assert.ok(!privateDetail.includes('secret-value') && !privateDetail.includes('C:\\Users\\alice'))

const overlongDetail = '外部错误 '.repeat(600)
const boundedOverlong = await runFailure(overlongDetail)
assert.ok(boundedOverlong.length <= 2000)
assert.ok(!boundedOverlong.includes(overlongDetail))

const report = {
  checkedAt: new Date().toISOString(),
  checks: [
    'Eagle API credential and local path text is sanitized before provider-service errors are thrown',
    'Eagle API error response and formatted provider error are each bounded to 2,000 characters'
  ],
  lengths: { privateDetail: privateDetail.length, overlongDetail: overlongDetail.length, boundedOverlong: boundedOverlong.length }
}
await writeFile(join(outDir, 'eagle-error-format.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(report, null, 2))
