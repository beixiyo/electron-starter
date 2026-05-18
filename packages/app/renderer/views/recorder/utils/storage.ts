import localforage from 'localforage'

/**
 * 通用存储服务接口
 */
export interface StorageService<T> {
  save: (key: string, value: T) => Promise<void>
  get: (key: string) => Promise<T | null>
  remove: (key: string) => Promise<void>
  clear: () => Promise<void>
  getAllKeys: () => Promise<string[]>
}

/**
 * 基础存储服务类
 */
export class BaseStorageService<T = any> implements StorageService<T> {
  private store: LocalForage

  constructor(config: LocalForageOptions = {}) {
    this.store = localforage.createInstance({
      name: 'BaseStorage',
      storeName: 'data',
      description: '通用数据存储',
      ...config,
    })
  }

  async save(key: string, value: T): Promise<void> {
    await this.store.setItem(key, value)
  }

  async get(key: string): Promise<T | null> {
    return await this.store.getItem<T>(key)
  }

  async remove(key: string): Promise<void> {
    await this.store.removeItem(key)
  }

  async clear(): Promise<void> {
    await this.store.clear()
  }

  async getAllKeys(): Promise<string[]> {
    return await this.store.keys()
  }

  async length(): Promise<number> {
    return await this.store.length()
  }
}

/**
 * 录屏记录元信息
 */
export interface RecorderRecordMetadata {
  /** 唯一标识 */
  id: string
  /** 用户自定义名称 */
  name: string
  /** 录制时间戳 */
  createdAt: number
  /** 文件类型（MIME type） */
  mimeType: string
  /** 文件大小（字节） */
  size: number
  /** 录制类型：'video' | 'audio' */
  captureKind: 'video' | 'audio'
  /** 是否包含系统音频 */
  systemAudio: boolean
  /** 是否包含麦克风音频 */
  micAudio: boolean
  /** 录制时长（毫秒，如果可获取） */
  duration?: number
}

/**
 * 录屏记录（包含元信息和 blob）
 */
export interface RecorderRecord {
  metadata: RecorderRecordMetadata
  blob: Blob
}

/**
 * 录屏数据存储服务
 */
export class RecorderStorage {
  private store: LocalForage

  constructor() {
    this.store = localforage.createInstance({
      name: 'RecorderStorage',
      storeName: 'records',
      description: '录屏数据存储',
    })
  }

  /**
   * 保存录屏记录
   */
  async saveRecord(
    blob: Blob,
    metadata: Omit<RecorderRecordMetadata, 'id' | 'createdAt' | 'size' | 'mimeType'>,
  ): Promise<string> {
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    const size = blob.size
    const mimeType = blob.type || 'application/octet-stream'

    const fullMetadata: RecorderRecordMetadata = {
      id,
      createdAt,
      size,
      mimeType,
      ...metadata,
    }

    /** 保存 blob */
    await this.store.setItem(this.getBlobKey(id), blob)

    /** 保存元信息 */
    await this.store.setItem(this.getMetadataKey(id), fullMetadata)

    /** 更新索引 */
    const index = await this.getMetadataIndex()
    index.push(id)
    await this.store.setItem(this.getMetadataIndexKey(), index)

    return id
  }

  /**
   * 获取元信息索引
   */
  private async getMetadataIndex(): Promise<string[]> {
    const index = await this.store.getItem<string[]>(this.getMetadataIndexKey())
    return index || []
  }

  /**
   * 获取所有录屏记录的元信息列表
   */
  async getAllMetadata(): Promise<RecorderRecordMetadata[]> {
    const index = await this.getMetadataIndex()
    const metadataList: RecorderRecordMetadata[] = []

    for (const id of index) {
      const metadata = await this.store.getItem<RecorderRecordMetadata>(
        this.getMetadataKey(id),
      )
      if (metadata) {
        metadataList.push(metadata)
      }
    }

    /** 按创建时间倒序排列 */
    return metadataList.sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 根据 ID 获取录屏记录
   */
  async getRecord(id: string): Promise<RecorderRecord | null> {
    const metadata = await this.store.getItem<RecorderRecordMetadata>(
      this.getMetadataKey(id),
    )
    if (!metadata) {
      return null
    }

    const stored = await this.store.getItem<Blob | ArrayBuffer>(this.getBlobKey(id))
    if (!stored) {
      return null
    }

    return {
      metadata,
      blob: this.ensureTypedBlob(stored, metadata.mimeType),
    }
  }

  /**
   * 根据 ID 获取 blob
   */
  async getBlob(id: string): Promise<Blob | null> {
    const metadata = await this.store.getItem<RecorderRecordMetadata>(
      this.getMetadataKey(id),
    )
    const stored = await this.store.getItem<Blob | ArrayBuffer>(this.getBlobKey(id))
    if (!stored) {
      return null
    }
    return this.ensureTypedBlob(stored, metadata?.mimeType)
  }

  /**
   * 根据 ID 获取元信息
   */
  async getMetadata(id: string): Promise<RecorderRecordMetadata | null> {
    return await this.store.getItem<RecorderRecordMetadata>(this.getMetadataKey(id))
  }

  /**
   * 删除录屏记录
   */
  async deleteRecord(id: string): Promise<void> {
    /** 删除 blob */
    await this.store.removeItem(this.getBlobKey(id))

    /** 删除元信息 */
    await this.store.removeItem(this.getMetadataKey(id))

    /** 更新索引 */
    const index = await this.getMetadataIndex()
    const newIndex = index.filter(itemId => itemId !== id)
    await this.store.setItem(this.getMetadataIndexKey(), newIndex)
  }

  /**
   * 更新录屏记录名称
   */
  async updateRecordName(id: string, name: string): Promise<void> {
    const metadata = await this.getMetadata(id)
    if (!metadata) {
      throw new Error(`Record with id ${id} not found`)
    }

    metadata.name = name
    await this.store.setItem(this.getMetadataKey(id), metadata)
  }

  /**
   * 清空所有录屏记录
   */
  async clearAll(): Promise<void> {
    const index = await this.getMetadataIndex()
    for (const id of index) {
      await this.store.removeItem(this.getBlobKey(id))
      await this.store.removeItem(this.getMetadataKey(id))
    }
    await this.store.removeItem(this.getMetadataIndexKey())
  }

  /**
   * 获取存储使用量（估算）
   */
  async getStorageSize(): Promise<number> {
    const index = await this.getMetadataIndex()
    let totalSize = 0

    for (const id of index) {
      const metadata = await this.getMetadata(id)
      if (metadata) {
        totalSize += metadata.size
      }
    }

    return totalSize
  }

  /**
   * IndexedDB 反序列化可能丢失 Blob.type 或将 Blob 降级为 ArrayBuffer，
   * 用元信息中的 mimeType 重建确保播放器能正确解码
   */
  private ensureTypedBlob(stored: Blob | ArrayBuffer, mimeType?: string): Blob {
    if (stored instanceof Blob && stored.type && stored.type === mimeType) {
      return stored
    }
    return new Blob([stored], { type: mimeType || '' })
  }

  private getBlobKey(id: string): string {
    return `recorder_record_${id}`
  }

  private getMetadataKey(id: string): string {
    return `recorder_metadata_${id}`
  }

  private getMetadataIndexKey(): string {
    return 'recorder_metadata_index'
  }
}

/** 导出录屏存储单例 */
export const recorderStorage = new RecorderStorage()
