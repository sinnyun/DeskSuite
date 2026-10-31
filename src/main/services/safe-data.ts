import { sanitizeErrorText } from './error-text.ts'

export const MAX_SAFE_DATA_STRING_CHARS = 12_000
export const MAX_SAFE_DATA_DEPTH = 8
export const MAX_SAFE_DATA_ARRAY_ITEMS = 100
export const MAX_SAFE_DATA_OBJECT_FIELDS = 200

const SECRET_KEY = /(password|passwd|token|secret|authorization|cookie|credential|private[-_]?key|api[-_]?key)/i

/** Clone JSON-like diagnostic data into a bounded, credential/path-scrubbed structure. */
export function safeData(value: unknown, depth = 0): unknown {
  if (depth >= MAX_SAFE_DATA_DEPTH) return '[深度限制]'
  if (typeof value === 'string') return sanitizeErrorText(value, MAX_SAFE_DATA_STRING_CHARS)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (value === undefined) return undefined
  if (typeof value !== 'object') return '[不支持的值]'

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_SAFE_DATA_ARRAY_ITEMS).map((item) => safeData(item, depth + 1))
    if (value.length > MAX_SAFE_DATA_ARRAY_ITEMS) items.push(`[其余 ${value.length - MAX_SAFE_DATA_ARRAY_ITEMS} 项已省略]`)
    return items
  }

  const result: Record<string, unknown> = {}
  let count = 0
  let truncated = false
  for (const key in value as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (count >= MAX_SAFE_DATA_OBJECT_FIELDS) {
      truncated = true
      break
    }
    count += 1
    if (SECRET_KEY.test(key)) {
      Object.defineProperty(result, key, { value: '[已脱敏]', enumerable: true, configurable: true, writable: true })
      continue
    }
    try {
      Object.defineProperty(result, key, { value: safeData((value as Record<string, unknown>)[key], depth + 1), enumerable: true, configurable: true, writable: true })
    } catch {
      Object.defineProperty(result, key, { value: '[无法读取]', enumerable: true, configurable: true, writable: true })
    }
  }
  if (truncated) result.__truncatedKeys = true
  return result
}

/** Keep bounded structure when it fits; otherwise return a fixed-size safe summary. */
export function boundedSafeData(value: unknown, maxBytes: number, reason: string): unknown {
  const summary = { omitted: true, reason }
  try {
    const safe = safeData(value)
    const serialized = JSON.stringify(safe)
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maxBytes) return summary
    return safe
  } catch {
    return summary
  }
}
