import type { NativeRecordingSource, RecordingPhase, RecordingSnapshot } from '@shared'
import { getLocalStorage, setLocalStorage } from '@jl-org/tool'
import { useSyncExternalStore } from 'react'
import { isElectron } from '@/utils/env'

/**
 * 手动 native tap 录音的音源多选状态（单一数据源，基于 useSyncExternalStore）
 *
 * - `micEnabled`：麦克风源（localStorage 持久化，默认开）
 * - `systemAudioMixEnabled`：系统音轨源「所有软件」（localStorage 持久化，默认关——权限语义较重须显式开启）
 * - `systemAudioSelectedPids`：系统音轨仅混入这些软件；空数组表示所有软件
 * - 录音快照（phase / elapsed / nativeSource）由主进程 stateChanged 事件推送
 *
 * 编排收口在此：组件只 dispatch（toggleMicSource / toggleAllAppsSource）并提示失败
 * 开录前选好音源即持久化；native 录音进行中点选**即刻热挂/卸**（麦克风与系统音轨独立热切）
 */

const MIC_ENABLED_STORAGE_KEY = 'recorder.micEnabled'
const SYSTEM_AUDIO_MIX_STORAGE_KEY = 'recorder.systemAudioMixEnabled'

export interface RecordingSourceState {
  /** 录音状态阶段（主进程广播） */
  phase: RecordingPhase
  /** 已录制秒数 */
  elapsed: number
  /** native 录音来源（undefined = 未在 native 录音） */
  nativeSource?: NativeRecordingSource
  /** 麦克风音源开关 */
  micEnabled: boolean
  /** 「所有软件」系统音轨音源开关 */
  systemAudioMixEnabled: boolean
  /** 系统音轨仅混入这些进程；空数组表示所有软件 */
  systemAudioSelectedPids: number[]
  /** 录音中热切正在等待 native / 授权结果（UI 据此锁定音源条，防重复点击堆积） */
  audioSourceSwitching: boolean
  /** 本机是否支持混系统音频（null = 未查询；false = 不支持，隐藏音源条） */
  systemAudioSupport: boolean | null
}

let state: RecordingSourceState = {
  phase: 'idle',
  elapsed: 0,
  nativeSource: undefined,
  micEnabled: getLocalStorage<boolean>(MIC_ENABLED_STORAGE_KEY) ?? true,
  systemAudioMixEnabled: getLocalStorage<boolean>(SYSTEM_AUDIO_MIX_STORAGE_KEY) ?? false,
  systemAudioSelectedPids: [],
  audioSourceSwitching: false,
  systemAudioSupport: null,
}

const listeners = new Set<() => void>()

function setState(patch: Partial<RecordingSourceState>): void {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): RecordingSourceState {
  return state
}

/** 组件订阅手动录音音源 / 状态 */
export function useRecordingSourceState(): RecordingSourceState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 命令式读取当前状态（非 hook，供事件回调 / 动作使用） */
export function getRecordingSourceState(): RecordingSourceState {
  return state
}

export function isRecordingBusy(): boolean {
  return state.phase === 'starting' || state.phase === 'recording' || state.phase === 'paused'
}

/** 当前是否为「可热切音源」的手动 native 录音（音源条 / controller 共用谓词） */
export function isManualNativeRecordingActive(): boolean {
  return isElectron()
    && state.nativeSource === 'manual'
    && (state.phase === 'recording' || state.phase === 'paused')
}

function applyAudioSourceState(mic: boolean, system: boolean, pids: number[]): void {
  setState({ micEnabled: mic, systemAudioMixEnabled: system, systemAudioSelectedPids: pids })
  setLocalStorage(MIC_ENABLED_STORAGE_KEY, mic)
  setLocalStorage(SYSTEM_AUDIO_MIX_STORAGE_KEY, system)
  void pushManualRecordingPrefs()
}

/**
 * 音源变更统一收口（乐观更新 + 录音中热切回滚）：
 * - 至少一个源：mic 与 system 都关时拒绝，UI 提示
 * - 非录音中：纯偏好写入（state + 持久化 + 同步主进程）
 * - 手动 native 录音进行中：先乐观落 state，再下发热挂/卸（可能弹系统授权框），
 *   失败回滚 state 并按 reason 提示，保证 UI 与 native 实际状态一致
 */
async function commitAudioSources(mic: boolean, system: boolean, pids: number[]): Promise<AudioSourceSwitchResult> {
  if (!mic && !system) {
    return { ok: false, reason: 'need-one-source' }
  }

  /** start 命令已冻结本次音源，ready 前不接受与 native 实际状态不一致的改动 */
  if (state.phase === 'starting')
    return { ok: false, reason: 'switching' }

  const prev = {
    mic: state.micEnabled,
    system: state.systemAudioMixEnabled,
    pids: state.systemAudioSelectedPids,
  }
  applyAudioSourceState(mic, system, pids)

  if (!isManualNativeRecordingActive()) {
    return { ok: true }
  }

  if (state.audioSourceSwitching) {
    applyAudioSourceState(prev.mic, prev.system, prev.pids)
    return { ok: false, reason: 'switching' }
  }

  setState({ audioSourceSwitching: true })
  try {
    const result = await $ipc.recording.setAudioSourceCapture({
      micEnabled: mic,
      systemEnabled: system,
      pids,
    })
    if (!result.ok) {
      applyAudioSourceState(prev.mic, prev.system, prev.pids)
      return { ok: false, reason: result.reason ?? 'failed' }
    }
    return { ok: true }
  }
  catch {
    applyAudioSourceState(prev.mic, prev.system, prev.pids)
    return { ok: false, reason: 'failed' }
  }
  finally {
    setState({ audioSourceSwitching: false })
  }
}

/** 切换麦克风源 */
export function toggleMicSource(): Promise<AudioSourceSwitchResult> {
  return commitAudioSources(!state.micEnabled, state.systemAudioMixEnabled, state.systemAudioSelectedPids)
}

/** 切换「所有软件」系统音轨源 */
export function toggleAllAppsSource(): Promise<AudioSourceSwitchResult> {
  const active = state.systemAudioMixEnabled && state.systemAudioSelectedPids.length === 0
  return active
    ? commitAudioSources(state.micEnabled, false, [])
    : commitAudioSources(state.micEnabled, true, [])
}

/** 切换一个指定软件；取消最后一个软件时关闭系统音轨，不静默扩大为所有软件 */
export function toggleAppSource(pid: number): Promise<AudioSourceSwitchResult> {
  const selected = state.systemAudioSelectedPids
  const next = selected.includes(pid)
    ? selected.filter(item => item !== pid)
    : [...selected, pid]

  return next.length === 0
    ? commitAudioSources(state.micEnabled, false, [])
    : commitAudioSources(state.micEnabled, true, next)
}

/** 把手动录音偏好（麦克风 / 混入系统音频开关）同步到主进程（开录瞬间读取最近一次同步值） */
export async function pushManualRecordingPrefs(): Promise<void> {
  if (!isElectron()) {
    return
  }

  try {
    await $ipc.recording.setManualRecordingPrefs({
      micEnabled: state.micEnabled,
      mixSystemAudio: state.systemAudioMixEnabled,
      pids: state.systemAudioSelectedPids,
    })
  }
  catch {
    /** 主进程未就绪等罕见时序：startManualRecording 侧有默认偏好兜底 */
  }
}

/**
 * 本机是否支持混系统音频（darwin 且 macOS >= 14.2），跨组件缓存：
 * null = 未查询；查询失败按不支持处理（入口隐藏，不误导用户）
 */
export async function ensureSystemAudioSupportChecked(): Promise<void> {
  if (!isElectron()) {
    setState({ systemAudioSupport: false })
    return
  }
  if (state.systemAudioSupport !== null) {
    return
  }

  try {
    setState({ systemAudioSupport: await $ipc.recording.getSystemAudioSupport() })
  }
  catch {
    setState({ systemAudioSupport: false })
  }
}

/** 统一开录入口（native tap）：开录前先把音源偏好同步到主进程 */
export async function startNativeRecording(): Promise<RecordingSnapshot | undefined> {
  if (!isElectron()) {
    return undefined
  }
  await pushManualRecordingPrefs()
  return $ipc.recording.start()
}

export function pauseNativeRecording(): Promise<RecordingSnapshot> | undefined {
  return isElectron()
    ? $ipc.recording.pause()
    : undefined
}

export function resumeNativeRecording(): Promise<RecordingSnapshot> | undefined {
  return isElectron()
    ? $ipc.recording.resume()
    : undefined
}

export function stopNativeRecording(): Promise<RecordingSnapshot> | undefined {
  return isElectron()
    ? $ipc.recording.stop()
    : undefined
}

export function resetNativeRecording(): Promise<RecordingSnapshot> | undefined {
  return isElectron()
    ? $ipc.recording.reset()
    : undefined
}

let unsubscribeIpc: (() => void) | null = null

function ingestSnapshot(s: RecordingSnapshot): void {
  setState({ phase: s.phase, elapsed: s.elapsed, nativeSource: s.nativeSource })
}

/** 订阅主进程录音状态（幂等，录音页挂载时调用一次即可） */
export function initRecordingStore(): void {
  if (!isElectron() || unsubscribeIpc) {
    return
  }

  /**
   * 拉取与订阅存在覆盖竞态：on 同步生效，getState 要一次 IPC 往返
   * 若往返期间状态变化（典型是录音结束），事件先写入新状态，随后 resolve 的
   * 陈旧快照会把它覆盖回去；而停止后主进程的 tick 已停，不会再有广播来纠正，
   * UI 就卡在错误的录音态。事件一到就作废这次拉取——订阅永远比拉取更新
   */
  let receivedPush = false

  void $ipc.recording.getState().then((s) => {
    if (receivedPush)
      return
    ingestSnapshot(s)
  })

  unsubscribeIpc = $ipc.recording.on('stateChanged', (s) => {
    receivedPush = true
    ingestSnapshot(s)
  })
}

export function disposeRecordingStore(): void {
  unsubscribeIpc?.()
  unsubscribeIpc = null
}

export type AudioSourceSwitchResult = {
  ok: boolean
  /** 失败原因：至少留一个源 / 热切等待中重复点击 / 非手动 native 录音中 / 系统音频权限被拒 / IPC 或 native 失败 */
  reason?: 'need-one-source' | 'switching' | 'not-recording' | 'permission-denied' | 'failed'
}
