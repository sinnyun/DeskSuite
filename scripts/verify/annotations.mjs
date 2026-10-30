#!/usr/bin/env node
// 用法：应用由 launch.mjs 启动后运行 node scripts/verify/annotations.mjs
import { writeFileSync } from 'node:fs'
import { connectCdp, ensureOutDir } from './common.mjs'

const cdp = await connectCdp()
const marker = `verify-${Date.now()}`
const expression = `async () => {
  const created = [];
  const invoke = (method, ...args) => window.bridge.invoke('annotations', method, ...args);
  try {
    const parent = await invoke('create', { name: '${marker}-parent' });
    created.push(parent.id);
    const child = await invoke('create', { name: '${marker}-child', parentId: parent.id });
    created.push(child.id);
    const renamed = await invoke('rename', { tagId: child.id, name: '${marker}-renamed' });
    const beforeMerge = await invoke('tree');
    const parentRow = beforeMerge.find((item) => item.id === parent.id);
    const childRow = parentRow?.children?.find((item) => item.id === child.id);
    if (renamed.name !== '${marker}-renamed' || !childRow || childRow.path !== parentRow.path + '/' + child.id) {
      throw new Error('标签重命名或物化路径断言失败');
    }
    const target = await invoke('create', { name: '${marker}-target' });
    created.push(target.id);
    await invoke('merge', { sourceId: parent.id, targetId: target.id });
    const afterMerge = await invoke('tree');
    const targetRow = afterMerge.find((item) => item.id === target.id);
    const mergedChild = targetRow?.children?.find((item) => item.id === child.id);
    if (!mergedChild || mergedChild.path !== targetRow.path + '/' + child.id) {
      throw new Error('标签合并未迁移子标签路径');
    }
    return { ok: true, renamed: renamed.name, mergedPath: mergedChild.path, createdCount: created.length };
  } finally {
    for (const id of created.reverse()) {
      try { await invoke('remove', id); } catch {}
    }
  }
}`

try {
  const result = await cdp.evaluate(`(${expression})()`)
  if (!result?.ok) throw new Error(JSON.stringify(result))
  ensureOutDir()
  const report = { checkedAt: new Date().toISOString(), ...result }
  writeFileSync(`${ensureOutDir()}/annotations.json`, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
