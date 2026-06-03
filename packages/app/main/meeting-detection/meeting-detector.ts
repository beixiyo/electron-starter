import type { AudioProcess } from './audio-monitor-bridge'
import { app } from 'electron'
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

/** 额外的「自身进程」pid 来源（如录制子进程），不属于 Chromium 进程树、getAppMetrics 抓不到 */
const selfPidSources = new Set<() => number[]>()

/**
 * 注册一个额外的自身 pid 来源，会议检测时一并排除
 * 用 getter 而非定值，确保进程重启后 pid 始终最新
 * @returns 取消注册的函数
 */
export function addSelfPidSource(getter: () => number[]): () => void {
  selfPidSources.add(getter)
  return () => selfPidSources.delete(getter)
}

/** 本 app 名下所有进程的 pid（主/渲染/GPU/Audio Service + 注册的子进程），用于排除自身录音误报 */
function getSelfPids(): Set<number> {
  const pids = new Set(app.getAppMetrics().map(metric => metric.pid))

  for (const getter of selfPidSources) {
    for (const pid of getter())
      pids.add(pid)
  }

  return pids
}

function handleProcessUpdate(processes: AudioProcess[]): void {
  const activeKeys = new Set<string>()
  const selfPids = getSelfPids()

  for (const proc of processes) {
    /** 长按 Fn 录音时，渲染层 getUserMedia(input) + AudioContext(output) 会让自身进程看起来像会议，排除掉 */
    if (selfPids.has(proc.pid))
      continue

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
