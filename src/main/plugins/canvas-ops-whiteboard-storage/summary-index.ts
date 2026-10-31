import { z } from 'zod'

export const MAX_BOARD_SUMMARIES = 10_000
export const MAX_BOARD_SUMMARY_TITLE_LENGTH = 200

const boardIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/)
export const boardSummaryIndexSchema = z.array(z.object({
  id: boardIdSchema,
  title: z.string().min(1).max(MAX_BOARD_SUMMARY_TITLE_LENGTH)
}).strict()).max(MAX_BOARD_SUMMARIES).nullable()

export type BoardSummary = { id: string; title: string }

export function parseBoardSummaryIndex(value: unknown): BoardSummary[] | null {
  return boardSummaryIndexSchema.parse(value)
}
