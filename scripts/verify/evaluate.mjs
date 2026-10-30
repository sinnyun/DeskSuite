#!/usr/bin/env node
// 用法：node scripts/verify/evaluate.mjs '<JS 表达式>'
//       node scripts/verify/evaluate.mjs --file probe.js
import { readFileSync } from 'node:fs'
import { connectCdp, parseFlags } from './common.mjs'

const { flags, rest } = parseFlags(process.argv.slice(2))
let expression = rest.join(' ').trim()
if (flags.file) expression = readFileSync(flags.file, 'utf8')
else if (!expression) expression = readFileSync(0, 'utf8').trim()
if (!expression) {
  console.error('用法：node scripts/verify/evaluate.mjs <表达式> | --file <文件>')
  process.exit(1)
}

const cdp = await connectCdp()
try {
  const value = await cdp.evaluate(expression)
  if (typeof value === 'string') console.log(value)
  else console.log(JSON.stringify(value, null, 2))
} finally {
  cdp.close()
}
