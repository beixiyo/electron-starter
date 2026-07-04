import type { NativeRecordingSource } from '@shared'

let activeSession: NativeRecordingSession | null = null

/**
 * 记录本次 native 录音（手动）的会话身份
 *
 * Native recorder 只在 stopped 事件里回传最终文件路径；这里在 start 前保存来源 / mime，
 * stopped 后据此把产物路由到对应收尾处理器。单槽：native 子进程同一时刻只允许一路录音，
 * consume 一次即清空
 */
export function setNativeRecordingSession(session: NativeRecordingSession): void {
  activeSession = session
}

export function consumeNativeRecordingSession(): NativeRecordingSession | null {
  const session = activeSession
  activeSession = null
  return session
}

export function clearNativeRecordingSession(): void {
  activeSession = null
}

export function hasNativeRecordingSession(): boolean {
  return activeSession !== null
}

export type NativeRecordingSession = {
  /** 录音来源，stopped/error 收尾按此路由到各自的处理器 */
  source: NativeRecordingSource
  /** 产物 MIME（m4a → audio/mp4），renderer 存 IndexedDB 用 */
  mimeType: string
}
