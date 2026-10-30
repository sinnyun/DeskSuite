export type ResourceKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'text' | 'document' | 'binary'

export interface ResourceRecord {
  id: string
  path: string
  name: string
  extension: string
  registeredAt: number
}

export interface ResourceInfo extends ResourceRecord {
  uri: string
  url: string
  mimeType: string
  kind: ResourceKind
  available: boolean
  size: number | null
  modifiedAt: number | null
  revision: string | null
}

export interface ResourceBytes {
  id: string
  revision: string
  offset: number
  total: number
  base64: string
  eof: boolean
}

export interface ResourcesService {
  register(path: string): Promise<ResourceInfo>
  resolve(reference: string): Promise<ResourceInfo>
  list(): Promise<ResourceInfo[]>
  forget(reference: string): Promise<boolean>
  read(reference: string, offset?: number, length?: number): Promise<ResourceBytes>
  readText(reference: string): Promise<{ resource: ResourceInfo; text: string }>
}

declare module 'cordis' {
  interface Context { resources: ResourcesService }
}
