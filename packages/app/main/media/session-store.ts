import type { MediaSessionSnapshot } from '@shared'

/**
 * 管理每个渲染进程的媒体会话快照
 */
export class MediaSessionStore {
  private readonly snapshots = new Map<number, WeakRef<MediaSessionSnapshot>>()

  /**
   * 读取指定渲染进程的快照
   */
  getSnapshot(webContentsId: number): MediaSessionSnapshot | null {
    const val = this.ensureSnapshot(webContentsId)
    return val || null
  }

  /**
   * 使用增量补丁更新快照
   */
  updateSnapshot(webContentsId: number, patch: Partial<MediaSessionSnapshot>): MediaSessionSnapshot {
    const next = {
      ...this.ensureSnapshot(webContentsId),
      ...patch,
    }
    this.snapshots.set(webContentsId, new WeakRef(next))
    return { ...next }
  }

  /**
   * 删除指定渲染进程的快照
   */
  deleteSnapshot(webContentsId: number): void {
    this.snapshots.delete(webContentsId)
  }

  private ensureSnapshot(webContentsId: number): MediaSessionSnapshot {
    /** 尝试获取现有的快照 */
    const existingRef = this.snapshots.get(webContentsId)
    const existingSnapshot = existingRef?.deref()

    /** 如果快照存在且未被 GC 回收，直接返回 */
    if (existingSnapshot) {
      return existingSnapshot
    }

    /** 如果快照不存在或已被 GC 回收，创建新的快照 */
    const newSnapshot: MediaSessionSnapshot = {
      systemAudio: true,
      microphoneAccess: 'unknown',
      screenAccess: 'unknown',
    }
    this.snapshots.set(webContentsId, new WeakRef(newSnapshot))
    return newSnapshot
  }
}

export const mediaSessionStore = new MediaSessionStore()
