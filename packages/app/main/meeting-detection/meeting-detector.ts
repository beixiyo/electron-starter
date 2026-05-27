import type { AudioProcess } from './audio-monitor-bridge'
import { onAudioProcessChange, startAudioMonitor, stopAudioMonitor } from './audio-monitor-bridge'
import { matchApp } from './meeting-apps'

export type MeetingSession = {
  /** 已知 app 的 id，未知 app 用 bundleId */
  appId: string
  /** 已知 app 显示友好名称，未知 app 显示进程名 */
  displayName: string
  pid: number
}

export type MeetingDetectorEvent
  = | { type: 'meeting-confirmed', session: MeetingSession }
    | { type: 'meeting-ended', session: MeetingSession }

export type MeetingDetectorListener = (event: MeetingDetectorEvent) => void

const eventListeners = new Set<MeetingDetectorListener>()
const sessions = new Map<string, MeetingSession>()
const dismissedKeys = new Set<string>()
let unsubAudioMonitor: (() => void) | null = null

function emitEvent(event: MeetingDetectorEvent): void {
  for (const listener of eventListeners) {
    listener(event)
  }
}

function handleProcessUpdate(processes: AudioProcess[]): void {
  const activeKeys = new Set<string>()

  for (const proc of processes) {
    if (!proc.isRunningInput || !proc.isRunningOutput)
      continue

    const known = matchApp(proc.bundleId)
    const appId = known?.id ?? proc.bundleId
    const key = `${appId}:${proc.pid}`
    activeKeys.add(key)

    if (!sessions.has(key) && !dismissedKeys.has(key)) {
      const session: MeetingSession = {
        appId,
        displayName: known?.displayName ?? proc.name,
        pid: proc.pid,
      }
      sessions.set(key, session)
      emitEvent({ type: 'meeting-confirmed', session })
    }
  }

  for (const [key, session] of sessions) {
    if (activeKeys.has(key))
      continue
    sessions.delete(key)
    emitEvent({ type: 'meeting-ended', session })
  }

  for (const key of dismissedKeys) {
    if (!activeKeys.has(key))
      dismissedKeys.delete(key)
  }
}

export function startMeetingDetector(): void {
  if (unsubAudioMonitor)
    return

  startAudioMonitor()
  unsubAudioMonitor = onAudioProcessChange(handleProcessUpdate)
}

export function stopMeetingDetector(): void {
  if (unsubAudioMonitor) {
    unsubAudioMonitor()
    unsubAudioMonitor = null
  }
  stopAudioMonitor()
  sessions.clear()
}

export function dismissSession(appId: string, pid: number): void {
  const key = `${appId}:${pid}`
  sessions.delete(key)
  dismissedKeys.add(key)
}

/** 保留 session（meeting-ended 仍会触发），仅禁止重弹 toast */
export function suppressSession(appId: string, pid: number): void {
  dismissedKeys.add(`${appId}:${pid}`)
}

export function onMeetingEvent(listener: MeetingDetectorListener): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}
