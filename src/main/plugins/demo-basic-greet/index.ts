import type { Context, Plugin } from 'cordis'

const greet: Plugin = {
  inject: ['ipc', 'config'],
  apply(ctx: Context): void {
    let count = 0

    ctx.ipc.handle('greet', {
      ping(name: string): string {
        count += 1
        return `你好，${name}！这是第 ${count} 次问候。`
      }
    })
  }
}

export default greet
