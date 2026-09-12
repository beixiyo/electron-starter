/** 语音会话的 renderer 快照、native 订阅生命周期与新轮通知。 */
import { isElectron } from '@/utils/env'
import type { VoiceImeActiveState } from '@shared'

const listeners = new Set<() => void>()
let snapshot: VoiceImeActiveState = {
  phase: 'idle',
  recordingStartedAt: null,
  surface: null,
  sessionId: null,
}
let snapshotVersion = 0
let nativeRefCount = 0
let nativeCleanup: (() => void) | null = null

export const voiceImeStore = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get phase() {
    return snapshot.phase
  },
  get activeId() {
    return snapshot.sessionId
  },
  get isActive() {
    return snapshot.phase !== 'idle'
  },
}

export function applyVoiceImeActiveState(next: VoiceImeActiveState): void {
  snapshotVersion += 1
  if (isSameState(snapshot, next)) return
  snapshot = next
  for (const listener of listeners) listener()
}

/**
 * 挂载主进程快照订阅；多个 renderer 宿主共享一条 native 订阅，最后一个卸载时才清理
 * Web 环境返回空清理函数，不触碰 `$ipc`
 */
export function initVoiceImeStore(source: VoiceImeStoreSource = createNativeSource()): () => void {
  if (!isElectron()) return () => {}

  if (nativeRefCount === 0) {
    const versionAtSubscribe = snapshotVersion
    let disposed = false
    const apply = (next: VoiceImeActiveState) => {
      if (!disposed) applyVoiceImeActiveState(next)
    }

    nativeCleanup = source.subscribe(apply)
    void source.getActiveState().then((next) => {
      /** 初始读取落后于事件广播时，旧快照不得覆盖较新的 session。 */
      if (!disposed && snapshotVersion === versionAtSubscribe) apply(next)
    }, () => undefined)

    const cleanupNative = nativeCleanup
    nativeCleanup = () => {
      disposed = true
      cleanupNative()
    }
  }

  nativeRefCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    nativeRefCount -= 1
    if (nativeRefCount > 0) return
    nativeCleanup?.()
    nativeCleanup = null
  }
}

/** 新一轮 recording 开始时通知撤销/失败 UI 清理旧缓冲。 */
export function onVoiceImeRoundStart(listener: () => void): () => void {
  let previous = snapshot
  return voiceImeStore.subscribe(() => {
    const next = snapshot
    if (
      next.phase === 'recording'
      && (previous.phase !== 'recording' || previous.sessionId !== next.sessionId)
    ) listener()
    previous = next
  })
}

export type VoiceImeStoreSource = {
  getActiveState: () => Promise<VoiceImeActiveState>
  subscribe: (listener: (state: VoiceImeActiveState) => void) => () => void
}

function createNativeSource(): VoiceImeStoreSource {
  return {
    getActiveState: () => $ipc.voiceIme.getActiveState(),
    subscribe: (listener) => $ipc.voiceIme.on('activeChanged', listener),
  }
}

function isSameState(a: VoiceImeActiveState, b: VoiceImeActiveState): boolean {
  return a.phase === b.phase
    && a.recordingStartedAt === b.recordingStartedAt
    && a.surface === b.surface
    && a.sessionId === b.sessionId
}
