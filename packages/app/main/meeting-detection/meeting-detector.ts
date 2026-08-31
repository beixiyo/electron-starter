import type { AudioProcess } from './audio-monitor-bridge'
import { getSelfProcessPids } from '@main/utils/self-pids'
import { getAudioProcessSnapshot, onAudioProcessChange, startAudioMonitor } from './audio-monitor-bridge'
import { isIgnoredApp, loadIgnoreOverrides, matchApp } from './meeting-apps'

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
  const selfPids = new Set(getSelfProcessPids())

  for (const proc of processes) {
    /** 长按 Fn 录音时，渲染层 getUserMedia(input) + AudioContext(output) 会让自身进程看起来像会议，排除掉 */
    if (selfPids.has(proc.pid))
      continue

    /** 输入法 / 听写工具（如 typeless）语音输入时会同时占 input+output，排除以免误判为会议 */
    if (isIgnoredApp(proc.bundleId, proc.name, proc.executablePath))
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

  loadIgnoreOverrides()
  startAudioMonitor()
  unsubAudioMonitor = onAudioProcessChange(handleProcessUpdate)
  /** monitor 可能已由录音页启动；立即消费现有快照，不能等下一次进程变化才恢复检测。 */
  handleProcessUpdate(getAudioProcessSnapshot())
}

export function stopMeetingDetector(): void {
  if (unsubAudioMonitor) {
    unsubAudioMonitor()
    unsubAudioMonitor = null
  }
  /** audio monitor 同时服务录音页的「当前发声应用」列表，停检测不能把共享数据源关掉。 */
  for (const session of sessions.values()) {
    emitEvent({ type: 'meeting-ended', session })
  }
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
