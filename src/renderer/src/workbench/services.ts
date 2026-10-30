const services = new Map<string, unknown>()

export function registerServices(pluginId: string, provided: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(provided)) {
    if (services.has(name)) {
      throw new Error(`渲染层服务重名：${name}（插件 ${pluginId}）`)
    }
    services.set(name, value)
  }
}

export function getService<T>(name: string): T | undefined {
  return services.get(name) as T | undefined
}

export function listServiceNames(): string[] {
  return [...services.keys()].sort()
}
