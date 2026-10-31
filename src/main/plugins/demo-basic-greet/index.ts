import type { Context, Plugin } from 'cordis'
import { z } from 'zod'

const greet: Plugin = {
  inject: ['ipc', 'config'],
  apply(ctx: Context): void {
    let count = 0

    ctx.ipc.handle('greet', {
      ping(name: string): string {
        count += 1
        return `你好，${name}！这是第 ${count} 次问候。`
      }
    }, { ping: z.tuple([z.string().trim().min(1).max(120)]) })
  }
}

export default greet
