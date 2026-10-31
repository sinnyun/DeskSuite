import { ZodError } from 'zod'

export const MAX_ERROR_TEXT = 2000
const SECRET_ASSIGNMENT = /\b(password|passwd|token|secret|authorization|cookie|credential|api[-_]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi
const ABSOLUTE_PATH = /\b[A-Z]:\\(?:[^\\\s,;"')\]]+\\)*[^\\\s,;"')\]]+/gi
const BEARER_TOKEN = /\bBearer\s+[^\s,;]+/gi
const UNIX_USER_PATH = /(?:^|[\s=(])\/(?:Users|home|mnt|media|Volumes|private|tmp)\/[^\s,;"')\]]+/g

export function sanitizeErrorText(message: string, maxLength = MAX_ERROR_TEXT): string {
  return message
    .replace(SECRET_ASSIGNMENT, '$1$2[已脱敏]')
    .replace(BEARER_TOKEN, 'Bearer [已脱敏]')
    .replace(ABSOLUTE_PATH, '[本机路径]')
    .replace(UNIX_USER_PATH, (match) => `${match[0] === '/' ? '' : match[0]}[本机路径]`)
    .slice(0, maxLength)
}

/** Convert an unknown thrown value into bounded, displayable text without JS object coercion. */
export function errorMessage(error: unknown, fallback = '操作失败'): string {
  let message: string
  if (error instanceof ZodError) {
    const details = error.issues.slice(0, 12).map((issue) => {
      const path = issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number').join('.')
      return `${path || '参数'}：${issue.message}`
    })
    message = `参数校验失败：${details.join('；')}${error.issues.length > details.length ? '；还有其他字段错误' : ''}`
  } else if (error instanceof Error) message = error.message
  else if (typeof error === 'string') message = error
  else if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') message = error.message
  else message = fallback

  const normalized = message.trim()
  return sanitizeErrorText(normalized || fallback)
}
