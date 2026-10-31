const MAX_PAYLOAD_CHARS = 48_000
const MAX_STRING_CHARS = 12_000
const MAX_ARRAY_ITEMS = 100
const MAX_OBJECT_KEYS = 200
const SECRET_KEY = /(password|passwd|token|secret|authorization|cookie|credential|private[-_]?key|api[-_]?key)/i
const SECRET_ASSIGNMENT = /\b(password|passwd|token|secret|authorization|cookie|credential|api[-_]?key)\b["']?\s*[:=]\s*["']?([^\s,;}"']+)/gi
const BEARER_TOKEN = /\bBearer\s+[^\s,;]+/gi
const WINDOWS_PATH = /(?:\b[A-Z]:\\|\\\\)[^\s<>:"|?*]+/gi
const UNIX_USER_PATH = /(?:^|[\s=(])\/(?:Users|home|mnt|media|Volumes|private|tmp)\/[^\s,;"')\]]+/g

export function safeText(value: string): string {
  let text = value
    .replace(SECRET_ASSIGNMENT, '$1=[已脱敏]')
    .replace(BEARER_TOKEN, 'Bearer [已脱敏]')
    .replace(WINDOWS_PATH, '[本机路径]')
    .replace(UNIX_USER_PATH, (match) => `${match[0] === '/' ? '' : match[0]}[本机路径]`)
  if (text.length > MAX_STRING_CHARS) text = `${text.slice(0, MAX_STRING_CHARS)}…[字符串已截断，共 ${text.length} 字符]`
  return text
}

/** Convert inbound values into a bounded JSON tree that structured-clone can transport. */
export function safePayload(value: unknown): unknown {
  const ancestors = new WeakSet<object>()
  const visit = (current: unknown, depth: number): unknown => {
    if (depth > 8) return '[深度限制]'
    if (current === undefined) return '[undefined]'
    if (typeof current === 'function') return '[函数已省略]'
    if (typeof current === 'symbol') return `[${String(current)}]`
    if (typeof current === 'bigint') return `${current.toString()}n`
    if (typeof current === 'string') {
      const dataUrl = current.match(/^data:([^;,]+);base64,/)
      return dataUrl
        ? `[二进制数据 ${dataUrl[1]}，约 ${Math.floor((current.length - current.indexOf(',') - 1) * 0.75)} 字节]`
        : safeText(current)
    }
    if (current === null || typeof current !== 'object') return current
    if (ancestors.has(current)) return '[循环引用]'

    ancestors.add(current)
    try {
      if (Array.isArray(current)) {
        const length = Math.min(current.length, MAX_ARRAY_ITEMS)
        const items: unknown[] = []
        for (let index = 0; index < length; index += 1) {
          try { items.push(visit(current[index], depth + 1)) }
          catch { items.push('[属性无法读取]') }
        }
        if (current.length > MAX_ARRAY_ITEMS) items.push(`[其余 ${current.length - MAX_ARRAY_ITEMS} 项已省略]`)
        return items
      }

      const keys = Object.keys(current)
      const result: Record<string, unknown> = Object.create(null)
      for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
        if (SECRET_KEY.test(key)) {
          result[key] = '[已脱敏]'
          continue
        }
        try { result[key] = visit((current as Record<string, unknown>)[key], depth + 1) }
        catch { result[key] = '[属性无法读取]' }
      }
      if (keys.length > MAX_OBJECT_KEYS) result.__truncatedKeys = keys.length - MAX_OBJECT_KEYS
      return result
    } catch {
      return '[对象无法安全读取]'
    } finally {
      ancestors.delete(current)
    }
  }
  return visit(value, 0)
}

export function boundedPayload(value: unknown): unknown {
  const safe = safePayload(value)
  try {
    const serialized = JSON.stringify(safe)
    if (typeof serialized !== 'string') return '[载荷无法安全序列化]'
    if (serialized.length <= MAX_PAYLOAD_CHARS) return safe
    return {
      __truncated: true,
      preview: serialized.slice(0, MAX_PAYLOAD_CHARS),
      originalChars: serialized.length,
      hint: '载荷超过 48 KB；已保留预览以控制调试缓冲区占用'
    }
  } catch {
    return '[载荷无法安全序列化]'
  }
}

export function safeLogEntry(input: object): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null)
  let keys: string[]
  try { keys = Object.keys(input) }
  catch { return { message: '[日志条目无法安全读取]' } }
  const values = input as Record<string, unknown>
  for (const key of keys) {
    try {
      const value = values[key]
      if (value === undefined) continue
      output[key] = key === 'payload' ? boundedPayload(value) : safePayload(value)
    } catch {
      output[key] = '[属性无法读取]'
    }
  }
  return output
}
