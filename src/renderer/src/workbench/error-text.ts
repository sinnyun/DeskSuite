import { ZodError } from 'zod'

const MAX_ERROR_TEXT_LENGTH = 2_000
const MAX_ZOD_ISSUES = 12
const SECRET_ASSIGNMENT = /\b(password|passwd|token|secret|authorization|cookie|credential|api[-_]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi
const ABSOLUTE_PATH = /\b[A-Z]:\\(?:[^\\\s,;"')\]]+\\)*[^\\\s,;"')\]]+/gi

function sanitize(message: string): string {
  return message
    .replace(SECRET_ASSIGNMENT, '$1$2[已脱敏]')
    .replace(ABSOLUTE_PATH, '[本机路径]')
    .slice(0, MAX_ERROR_TEXT_LENGTH)
}

/** Extract bounded, readable error text without coercing arbitrary objects. */
export function errorText(cause: unknown, fallback = '操作失败'): string {
  if (cause instanceof ZodError) {
    const issues = cause.issues.slice(0, MAX_ZOD_ISSUES).map((issue) => {
      const path = issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
      const field = path.length ? path.join(' › ') : '设置值'
      const message = issue.code === 'invalid_type' ? '数据类型不正确'
        : issue.code === 'invalid_value' ? '值不在允许范围内'
          : issue.code === 'too_small' ? '值小于允许范围'
            : issue.code === 'too_big' ? '值超过允许范围'
              : issue.code === 'invalid_format' ? '格式不正确'
                : issue.code === 'unrecognized_keys' ? '包含未知字段'
                  : issue.code === 'custom' && /[\u3400-\u9fff]/.test(issue.message) ? issue.message
                    : '值不符合要求'
      return `字段 ${field}：${message}`
    })
    if (cause.issues.length > MAX_ZOD_ISSUES) issues.push(`另有 ${cause.issues.length - MAX_ZOD_ISSUES} 项错误`)
    return sanitize(issues.join('；') || fallback)
  }

  let message = ''
  if (cause instanceof Error) message = cause.message
  else if (typeof cause === 'string') message = cause
  else if (typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string') message = cause.message
  message = message.trim()
  if (!message || message === '[object Object]') message = fallback
  return sanitize(message)
}
