import { z } from 'zod'

const resourceKindSchema = z.enum(['image', 'video', 'audio', 'pdf', 'markdown', 'text', 'document', 'binary'])

export const resourceInfoSchema = z.object({
  id: z.string().uuid(),
  path: z.string().min(1),
  name: z.string().min(1),
  extension: z.string().max(24),
  registeredAt: z.number().finite().nonnegative(),
  uri: z.string().startsWith('desksuite-resource://local/'),
  url: z.string().startsWith('desksuite-resource://local/'),
  mimeType: z.string().min(1).max(255),
  kind: resourceKindSchema,
  available: z.boolean(),
  size: z.number().finite().nonnegative().nullable(),
  modifiedAt: z.number().finite().nonnegative().nullable(),
  revision: z.string().min(1).nullable()
}).passthrough()

export const resourceListSchema = resourceInfoSchema.array()
export const forgetResultSchema = z.boolean()

export const resourceBytesSchema = z.object({
  id: z.string().uuid(),
  revision: z.string().min(1),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  base64: z.string().max(1_398_104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  eof: z.boolean()
}).passthrough().refine((value) => value.offset <= value.total && value.base64.length <= Math.ceil(Math.min(value.total - value.offset, 1_048_576) / 3) * 4, {
  message: 'Resource byte range exceeds the declared source bounds'
})

export const resourceTextSchema = z.object({
  resource: resourceInfoSchema,
  text: z.string().max(1_048_576)
}).passthrough()
