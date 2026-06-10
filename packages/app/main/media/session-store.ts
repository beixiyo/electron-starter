import type { MediaSessionSnapshot } from '@shared'

/**
 * 管理每个渲染进程的媒体会话快照
 *
 * 必须持强引用：快照是用户偏好（如关闭系统音频）的唯一存储，
 * 用 WeakRef 会在任意一次 GC 后悄悄丢失并重建默认值。
 * 条目的生命周期由窗口 closed 事件里的 deleteSnapshot 负责清理
 */
export class MediaSessionStore {
  private readonly snapshots = new Map<number, MediaSessionSnapshot>()

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
    this.snapshots.set(webContentsId, next)
    return { ...next }
  }

  /**
   * 删除指定渲染进程的快照
   */
  deleteSnapshot(webContentsId: number): void {
    this.snapshots.delete(webContentsId)
  }

  private ensureSnapshot(webContentsId: number): MediaSessionSnapshot {
    const existingSnapshot = this.snapshots.get(webContentsId)
    if (existingSnapshot) {
      return existingSnapshot
    }

    const newSnapshot: MediaSessionSnapshot = {
      systemAudio: true,
      microphoneAccess: 'unknown',
      screenAccess: 'unknown',
    }
    this.snapshots.set(webContentsId, newSnapshot)
    return newSnapshot
  }
}

export const mediaSessionStore = new MediaSessionStore()
