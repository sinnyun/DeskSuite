import { z } from 'zod'

export const drivePreferencesSchema = z.object({
  showNetworkDrives: z.boolean()
}).strict()
