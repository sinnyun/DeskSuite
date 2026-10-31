import { z } from 'zod'

export const windowStateSchema = z.object({
  maximized: z.boolean(),
  fullscreen: z.boolean(),
  focused: z.boolean()
}).strict()
