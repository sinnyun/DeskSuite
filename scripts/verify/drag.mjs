#!/usr/bin/env node
// 用法：node scripts/verify/drag.mjs --title 剪贴板 [--dx 120] [--dy 80]
import { connectCdp, parseFlags } from './common.mjs'

const { flags } = parseFlags(process.argv.slice(2))
const title = flags.title
const dx = Number(flags.dx ?? 120)
const dy = Number(flags.dy ?? 80)
if (!title || typeof title !== 'string') {
  console.error('用法：node scripts/verify/drag.mjs --title <悬浮面板标题> [--dx 120] [--dy 80]')
  process.exit(1)
}

const cdp = await connectCdp()

const locate = (action) => `(() => {
  const panels = [...document.querySelectorAll('div')].filter((el) =>
    (el.className || '').toString().includes('fixed z-50')
  );
  const panel = panels.find((el) => el.textContent.includes(${JSON.stringify(title)}));
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  const header = panel.firstElementChild.getBoundingClientRect();
  return ${action === 'header'
    ? `{ x: Math.round(rect.x), y: Math.round(rect.y), hx: Math.round(header.x + header.width / 2), hy: Math.round(header.y + header.height / 2) }`
    : `{ x: Math.round(rect.x), y: Math.round(rect.y) }`};
})()`

try {
  const before = await cdp.evaluate(locate('header'))
  if (!before) throw new Error(`未找到标题含「${title}」的悬浮面板，请先打开该面板`)

  const mouse = (type, x, y) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1
    })

  await mouse('mousePressed', before.hx, before.hy)
  await mouse('mouseMoved', before.hx + dx / 2, before.hy + dy / 2)
  await mouse('mouseMoved', before.hx + dx, before.hy + dy)
  await mouse('mouseReleased', before.hx + dx, before.hy + dy)

  const after = await cdp.evaluate(locate('panel'))
  console.log(
    JSON.stringify(
      {
        panel: title,
        before: { x: before.x, y: before.y },
        after,
        moved: { x: after.x - before.x, y: after.y - before.y },
        expected: { x: dx, y: dy }
      },
      null,
      2
    )
  )
} finally {
  cdp.close()
}
