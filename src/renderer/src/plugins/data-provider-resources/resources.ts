import { callValidated } from '../../workbench/sdk'
import type { ILeaferImage } from 'leafer-ui'
import { forgetResultSchema, resourceBytesSchema, resourceInfoSchema, resourceListSchema, resourceTextSchema } from './schemas'

export interface ResourceInfo {
  id: string; path: string; name: string; extension: string; registeredAt: number
  uri: string; url: string; mimeType: string
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'document' | 'binary'
  available: boolean; size: number | null; modifiedAt: number | null; revision: string | null
}

export interface ImageLease { leaseId: string; key: string; url: string; resource: ResourceInfo; width: number; height: number }

const images = new Map<string, { refs: number; promise: Promise<ILeaferImage> }>()
const leases = new Map<string, { key: string; image: ILeaferImage }>()

export const resources = {
  register: (path: string): Promise<ResourceInfo> => callValidated(resourceInfoSchema, 'resources', 'register', path),
  registerFile: (file: File): Promise<ResourceInfo> => callValidated(resourceInfoSchema, 'resources', 'register', file),
  resolve: (reference: string): Promise<ResourceInfo> => callValidated(resourceInfoSchema, 'resources', 'resolve', reference),
  list: (): Promise<ResourceInfo[]> => callValidated(resourceListSchema, 'resources', 'list'),
  choose: (): Promise<ResourceInfo[]> => callValidated(resourceListSchema, 'resources', 'choose'),
  forget: (reference: string): Promise<boolean> => callValidated(forgetResultSchema, 'resources', 'forget', reference),
  read: (reference: string, offset = 0, length = 65536): Promise<{ id: string; revision: string; offset: number; total: number; base64: string; eof: boolean }> => callValidated(resourceBytesSchema, 'resources', 'read', reference, offset, length),
  readText: (reference: string): Promise<{ resource: ResourceInfo; text: string }> => callValidated(resourceTextSchema, 'resources', 'readText', reference),
  async acquireImage(reference: string): Promise<ImageLease> {
    const resource = await resources.resolve(reference)
    if (!resource.available || resource.kind !== 'image') throw new Error('资源不是可用的图片')
    const key = resource.url
    let entry = images.get(key)
    if (!entry) {
      entry = {
        refs: 0,
        promise: import('leafer-ui').then(async ({ Resource }) => {
          const cached = Resource.get(key) as ILeaferImage | undefined
          if (cached?.ready) return cached
          if (cached && !cached.error) return new Promise<ILeaferImage>((resolve, reject) => cached.load(() => resolve(cached), reject))
          if (cached?.use) throw new Error('图片加载失败，仍有其他元素引用此资源')
          if (cached) Resource.remove(key)
          return Resource.loadImage(key)
        })
      }
      images.set(key, entry)
    }
    entry.refs += 1
    try {
      const image = await entry.promise
      image.use += 1 // Participate in Leafer's own reference count, including during node creation.
      const leaseId = crypto.randomUUID()
      leases.set(leaseId, { key, image })
      return { leaseId, key, url: key, resource, width: image.width, height: image.height }
    } catch (error) {
      entry.refs -= 1
      if (!entry.refs) {
        images.delete(key)
        const { Resource } = await import('leafer-ui')
        const failed = Resource.get(key) as ILeaferImage | undefined
        if (!images.has(key) && failed && !failed.use) Resource.remove(key)
      }
      throw error
    }
  },
  async releaseImage(leaseId: string): Promise<void> {
    const lease = leases.get(leaseId)
    if (!lease) return
    const { key, image } = lease
    leases.delete(leaseId)
    image.use -= 1
    const entry = images.get(key)
    if (!entry || --entry.refs > 0) return
    images.delete(key)
    const { Resource } = await import('leafer-ui')
    // A lease must outlive its Leafer nodes. Never call global Resource.destroy().
    if (!images.has(key) && Resource.get(key) === image && !image.use) Resource.remove(key)
  },
  getImageCacheState: (): { entries: number; leases: number } => ({ entries: images.size, leases: leases.size })
}
