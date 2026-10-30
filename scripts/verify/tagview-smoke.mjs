#!/usr/bin/env node
// 标签聚合链路冒烟：创建父子标签 → 分配样例文件 → tag_files 验证子孙聚合
// 用法：DESKSUITE_MCP_URL=http://127.0.0.1:9601/mcp node scripts/verify/tagview-smoke.mjs
import { mcpUrl } from './common.mjs'

let nextId = 1

async function rpc(method, params) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
  })
  const text = await res.text()
  const dataLines = text.split('\n').filter((line) => line.startsWith('data:'))
  const payload = dataLines.length ? JSON.parse(dataLines[dataLines.length - 1].slice(5)) : JSON.parse(text)
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`)
  return payload.result
}

async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args })
  return result.content.map((item) => item.text).join('\n')
}

const sample = (name) => `E:\\ai\\DeskSuite\\artifacts\\verify\\samples\\tagview\\${name}`

const parent = JSON.parse(await callTool('tag_create', { name: `验证素材-${Date.now() % 100000}` }))
const child = JSON.parse(await callTool('tag_create', { name: '图片', parentId: parent.id }))
console.log(`parent=${parent.id} (${parent.name}) child=${child.id} (${child.name})`)

console.log('assign parent:', await callTool('tag_assign', { paths: [sample('alpha.txt'), sample('beta.md')], tagId: parent.id }))
console.log('assign child:', await callTool('tag_assign', { paths: [sample('gamma.png')], tagId: child.id }))

const fromParent = JSON.parse(await callTool('tag_files', { tagId: parent.id }))
const fromChild = JSON.parse(await callTool('tag_files', { tagId: child.id }))
console.log('tag_files(parent):', fromParent)
console.log('tag_files(child):', fromChild)

const expected = ['alpha.txt', 'beta.md', 'gamma.png'].map(sample).sort()
if (JSON.stringify(fromParent) !== JSON.stringify(expected)) {
  console.error('失败：父标签聚合未包含子孙标签文件')
  process.exit(1)
}
if (JSON.stringify(fromChild) !== JSON.stringify([sample('gamma.png')])) {
  console.error('失败：子标签聚合结果不正确')
  process.exit(1)
}
console.log('标签聚合链路验证通过：父标签包含直接分配与子孙标签的全部文件')
