export async function call<T = unknown>(
  service: string,
  method: string,
  ...args: unknown[]
): Promise<T> {
  return (await window.bridge.invoke(service, method, ...args)) as T
}
