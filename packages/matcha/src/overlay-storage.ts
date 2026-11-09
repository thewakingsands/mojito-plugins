// Copyright (c) FFCafe. Licensed under AGPL-3.0-only.
import type { PluginContext } from '@ffcafe/mojito-plugin-sdk'

const keys = new Set([
  'config:app-minified',
  'config:market-transpose',
  'config:market-hq-only',
  'config:submarine-spot',
  'force-april-style',
  'gearset-item',
  'gearset-item:ver',
  'matcha-fishing-v1',
])
export class OverlayStorage {
  private writes = new Map<string, Promise<void>>()
  constructor(private readonly context: Pick<PluginContext, 'config' | 'storage' | 'limits'>) {}
  private key(key: string) {
    if (!key.startsWith('overlay.') || !keys.has(key.slice(8))) throw new Error('Unknown overlay setting')
    return key.slice(8)
  }
  private large(key: string) {
    return key === 'gearset-item' || key === 'matcha-fishing-v1'
  }
  private path(key: string) {
    return `overlay/${key}.json`
  }
  async get(key: string): Promise<string | null> {
    const bare = this.key(key)
    await this.writes.get(key)
    if (!this.large(bare)) {
      const value = await this.context.config.get(key)
      return typeof value === 'string' ? value : null
    }
    try {
      return new TextDecoder().decode(await this.context.storage.read(this.path(bare)))
    } catch (error) {
      if ((error as { code?: string }).code === 'not_found') return null
      throw error
    }
  }
  async set(key: string, value: string | null): Promise<void> {
    const bare = this.key(key)
    const prior = this.writes.get(key) ?? Promise.resolve()
    const pending = prior
      .catch(() => {})
      .then(async () => {
        if (!this.large(bare)) {
          await this.context.config.set(key, value)
          return
        }
        if (value === null) {
          await this.context.storage.delete(this.path(bare))
          return
        }
        const bytes = new TextEncoder().encode(value)
        if (bytes.length > this.context.limits.values['storage.fileBytes'])
          throw new Error('保存的数据超过宿主文件大小限制')
        await this.context.storage.write(this.path(bare), bytes)
      })
    this.writes.set(key, pending)
    try {
      await pending
    } finally {
      if (this.writes.get(key) === pending) this.writes.delete(key)
    }
  }
  async drain() {
    await Promise.allSettled(this.writes.values())
  }
}
