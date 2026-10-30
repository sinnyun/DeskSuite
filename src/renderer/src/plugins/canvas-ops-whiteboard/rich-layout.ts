import { Box, Text } from 'leafer-ui'
import DOMPurify from 'dompurify'
import type { BoardNode } from './contract'

interface RunStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
  size: number
}
/** Small supported formatting subset shared by on-canvas text and static export. */
export function drawRichText(box: Box, node: BoardNode): void {
  const root = document.createElement('div')
  if (node.html)
    root.innerHTML = DOMPurify.sanitize(node.html, {
      ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'font'],
      ALLOWED_ATTR: ['style', 'color', 'size']
    })
  else root.textContent = node.text ?? ''
  const canvas = document.createElement('canvas'),
    context = canvas.getContext('2d')!
  const fontSize = node.type === 'text' ? 20 : 18,
    lineHeight = fontSize * 1.5
  let x = 12,
    y = 12,
    line = 0
  const newline = (): void => {
    x = 12
    y += lineHeight
    line++
  }
  const append = (text: string, style: RunStyle): void => {
    for (const token of text.split(/(\n|\s+)/)) {
      if (!token) continue
      if (token.includes('\n')) {
        for (let i = 0; i < token.split('\n').length - 1; i++) newline()
        continue
      }
      context.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px Arial`
      const width = context.measureText(token).width
      if (x + width > node.width - 12 && x > 12) newline()
      if (y + lineHeight > node.height) break
      // Long words wrap by character to stay inside the card.
      if (width > node.width - 24) {
        for (const c of token) {
          const cw = context.measureText(c).width
          if (x + cw > node.width - 12) newline()
          if (y + lineHeight <= node.height)
            box.add(
              new Text({
                x,
                y,
                text: c,
                fontSize: style.size,
                fontFamily: 'Arial',
                fontWeight: style.bold ? 'bold' : 'normal',
                italic: style.italic,
                textDecoration: style.underline ? 'under' : undefined,
                fill: style.color
              })
            )
          x += cw
        }
        continue
      }
      box.add(
        new Text({
          x,
          y,
          text: token,
          fontSize: style.size,
          fontFamily: 'Arial',
          fontWeight: style.bold ? 'bold' : 'normal',
          italic: style.italic,
          textDecoration: style.underline ? 'under' : undefined,
          fill: style.color
        })
      )
      x += width
    }
  }
  const visit = (element: Node, style: RunStyle): void => {
    if (element.nodeType === Node.TEXT_NODE) {
      append(element.textContent ?? '', style)
      return
    }
    if (!(element instanceof HTMLElement)) return
    const tag = element.tagName.toLowerCase(),
      css = element.style
    const next = {
      ...style,
      bold: style.bold || tag === 'b' || tag === 'strong' || css.fontWeight === 'bold' || Number(css.fontWeight) >= 600,
      italic: style.italic || tag === 'i' || tag === 'em' || css.fontStyle === 'italic',
      underline: style.underline || tag === 'u' || css.textDecoration.includes('underline'),
      color: css.color || element.getAttribute('color') || style.color
    }
    const block = ['div', 'p', 'li', 'ul', 'ol'].includes(tag)
    if (block && x > 12) newline()
    if (tag === 'br') {
      newline()
      return
    }
    if (tag === 'li') {
      const parent = element.parentElement
      const index = parent ? [...parent.children].indexOf(element) + 1 : 1
      append(parent?.tagName === 'OL' ? `${index}. ` : '• ', next)
    }
    for (const child of element.childNodes) visit(child, next)
    if (block && x > 12) newline()
  }
  visit(root, { bold: false, italic: false, underline: false, color: '#1e293b', size: fontSize })
  void line
}
