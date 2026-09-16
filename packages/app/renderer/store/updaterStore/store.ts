import { isElectron } from '@/utils/env'
import type { UpdateCheckOutcome, UpdateErrorCode, UpdateInfoLite, UpdateProgress, UpdateStatus, UpdateStatusEvent } from '@ipc/services/update/contract'
import type { UpdaterPromptSource, UpdaterState, UpdaterStoreOptions, UpdaterStatus } from './types'
import { UPDATE_ERROR_CODES } from '@ipc/services/update/contract'
import { useSyncExternalStore } from 'react'

/**
 * 应用更新全局状态（单一数据源，基于 `useSyncExternalStore`）
 *
 * 主进程通过 `status` / `progress` 事件推送自动更新状态，设置入口与全局弹窗共享同一份
 * 快照。弹窗节奏和策略都只保存在当前会话，不写入本地存储，避免旧记忆遮住新的强制更新判定
 */

/** 当前环境是否支持更新（仅 Electron 桌面端）。 */
export const updaterAvailable = isElectron()

const DEFAULT_AUTO_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000

let state: UpdaterState = {
  currentVersion: '',
  status: 'idle',
  info: null,
  progress: null,
  error: null,
  modalOpen: false,
  forceUpdate: false,
  policyTitle: '',
  policyNotes: '',
}

const listeners = new Set<() => void>()

let initialized = false
let currentVersionPromise: Promise<string> | null = null
let policyRequestId = 0
let checkRequestId = 0
let promptRequestId = 0
let lastAutoPromptAt: number | null = null
let autoPromptPending = false
let autoPromptRequestId: number | null = null
let downloadRequestId = 0
let installRequestId = 0
let storeOptions: Required<Pick<UpdaterStoreOptions, 'canPrompt' | 'checkPolicy' | 'autoOpenOnAvailable'>> & { autoPromptIntervalMs: number } = {
  canPrompt: () => true,
  checkPolicy: () => ({ forceUpdate: false }),
  autoPromptIntervalMs: DEFAULT_AUTO_PROMPT_INTERVAL_MS,
  autoOpenOnAvailable: false,
}

/** 整体替换引用并通知订阅者，保证 React 能看到新的快照。 */
function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): UpdaterState {
  return state
}

/** 组件订阅全局更新状态。 */
export function useUpdaterState(): UpdaterState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 把主进程传来的错误码归一化为 `update` 命名空间下的 i18n key
 * 未知来源不把原始文本当作 key，统一回退到 `errors.unknown`
 */
export function updateErrorI18nKey(raw?: string | null): `errors.${UpdateErrorCode}` {
  const code = raw && (UPDATE_ERROR_CODES as readonly string[]).includes(raw)
    ? raw as UpdateErrorCode
    : 'unknown'
  return `errors.${code}`
}

/** 将 IPC 或 Promise 拒绝归一成渲染端可消费的错误码。 */
function normalizeErrorCode(raw?: string | null): UpdateErrorCode {
  return raw && (UPDATE_ERROR_CODES as readonly string[]).includes(raw)
    ? raw as UpdateErrorCode
    : 'unknown'
}

/**
 * 订阅主进程更新事件（幂等，App 挂载时调用一次即可）
 *
 * `options` 是模板宿主的策略注入点；不传时只使用 electron-updater 自身的结果，且不会
 * 自行判定强制更新
 */
export function initUpdaterStore(options: UpdaterStoreOptions = {}): void {
  if (initialized || !updaterAvailable) return

  initialized = true
  storeOptions = {
    canPrompt: options.canPrompt ?? (() => true),
    checkPolicy: options.checkPolicy ?? (() => ({ forceUpdate: false })),
    autoPromptIntervalMs: Math.max(0, options.autoPromptIntervalMs ?? DEFAULT_AUTO_PROMPT_INTERVAL_MS),
    autoOpenOnAvailable: options.autoOpenOnAvailable ?? false,
  }

  currentVersionPromise = Promise.resolve()
    .then(() => $ipc.update.getVersion())
    .then((version) => {
      const normalized = typeof version === 'string'
        ? version
        : ''
      setState({ currentVersion: normalized })
      return normalized
    })
    .catch(() => {
      setState({ currentVersion: '' })
      return ''
    })

  $ipc.update.on('status', handleStatus)
  $ipc.update.on('progress', handleProgress)
  exposeUpdaterDebugHandle()
  /** 监听就绪后首检，避免主进程事件先到而丢失。 */
  void checkUpdate()
}

function handleStatus(payload: UpdateStatusEvent): void {
  invalidatePromptRequests()

  const forceUnavailable = state.forceUpdate && payload.status === 'not-available'
  const nextStatus: UpdateStatus = forceUnavailable
    ? 'error'
    : payload.status
  const patch: Partial<UpdaterState> = {
    status: nextStatus,
    error: forceUnavailable
      ? 'unknown'
      : payload.status === 'error'
      ? normalizeErrorCode(payload.error)
      : null,
  }

  if (forceUnavailable) patch.modalOpen = true

  if (payload.info) patch.info = payload.info

  if (payload.status !== 'downloading' && payload.status !== 'downloaded') patch.progress = null

  if (payload.status === 'checking' || payload.status === 'not-available' || payload.status === 'error') {
    policyRequestId++
    patch.policyTitle = ''
    patch.policyNotes = ''
  }

  setState(patch)

  if (payload.status !== 'available' || !payload.info) return

  const info = payload.info
  const forceAlreadyLocked = state.forceUpdate
  void checkPolicy(info)

  if (forceAlreadyLocked) requestUpdaterModalOpen('auto-force', info)
  else if (storeOptions.autoOpenOnAvailable && canAutoPrompt()) requestUpdaterModalOpen('auto-available', info)
}

function handleProgress(payload: UpdateProgress): void {
  invalidatePromptRequests()
  setState({ progress: payload, status: 'downloading', error: null })
}

/**
 * 检查更新；结果通过 status 事件驱动 UI
 * 直接调用失败时补一条 `unknown` 状态，避免无事件的 IPC rejection 让弹窗一直停在 checking
 */
export async function checkUpdate(): Promise<UpdateCheckOutcome | undefined> {
  if (!updaterAvailable) return

  const requestId = ++checkRequestId
  invalidatePromptRequests()
  setState({ error: null, status: 'checking', progress: null })

  try {
    return await $ipc.update.check()
  }
  catch {
    if (requestId === checkRequestId && state.status === 'checking') setState({ status: 'error', error: 'unknown' })
    return undefined
  }
}

/** 开始下载更新。 */
export function downloadUpdate(): void {
  if (!updaterAvailable) return

  const requestId = ++downloadRequestId
  invalidatePromptRequests()
  setState({ error: null, progress: null, status: 'downloading' })
  void $ipc.update.download().catch(() => {
    if (requestId !== downloadRequestId || state.status !== 'downloading') return

    setState({ status: 'error', error: 'unknown', progress: null })
  })
}

/** 退出并安装已下载好的更新。 */
export function installUpdate(): void {
  if (!updaterAvailable) return

  const requestId = ++installRequestId
  invalidatePromptRequests()
  void $ipc.update.install().catch(() => {
    if (requestId !== installRequestId || state.status !== 'downloaded') return

    setState({ status: 'error', error: 'unknown' })
  })
}

/** 打开弹窗（手动触发时也补一次检查，让用户看到最新结果）。 */
export function openUpdaterModal(): void {
  /** 即使已下载也重新检查，避免把常驻期间过期的包安装掉。 */
  void checkUpdate()
  requestUpdaterModalOpen('manual', state.info)
}

/** 关闭弹窗；强制更新锁定时拒绝关闭。 */
export function closeUpdaterModal(): void {
  invalidatePromptRequests()
  if (state.forceUpdate) return
  setState({ modalOpen: false })
}

function canAutoPrompt(): boolean {
  if (autoPromptPending) return false

  return lastAutoPromptAt === null || Date.now() - lastAutoPromptAt >= storeOptions.autoPromptIntervalMs
}

function invalidatePromptRequests(): void {
  promptRequestId++
  autoPromptPending = false
  autoPromptRequestId = null
}

function requestUpdaterModalOpen(source: UpdaterPromptSource, info: UpdateInfoLite | null): void {
  invalidatePromptRequests()
  if (source === 'auto-available') autoPromptPending = true

  const requestId = ++promptRequestId
  const forceUpdate = state.forceUpdate
  if (source === 'auto-available') autoPromptRequestId = requestId

  void Promise.resolve()
    .then(() =>
      storeOptions.canPrompt({
        source,
        info,
        forceUpdate,
      })
    )
    .then((allowed) => {
      if (!allowed || requestId !== promptRequestId) return

      if (source === 'auto-available') lastAutoPromptAt = Date.now()

      setState({ modalOpen: true })
    })
    .catch(() => {
      /** 策略拒绝视为不允许弹窗；不把策略异常显示成更新失败。 */
    })
    .finally(() => {
      if (source === 'auto-available' && autoPromptRequestId === requestId) {
        autoPromptPending = false
        autoPromptRequestId = null
      }
    })
}

async function checkPolicy(info: UpdateInfoLite): Promise<void> {
  const requestId = ++policyRequestId
  try {
    const currentVersion = currentVersionPromise
      ? await currentVersionPromise
      : state.currentVersion
    const policy = await storeOptions.checkPolicy({ currentVersion, info }) ?? {}

    if (requestId !== policyRequestId) return

    setState({
      forceUpdate: Boolean(policy.forceUpdate),
      policyTitle: policy.title ?? '',
      policyNotes: policy.notes ?? '',
    })

    if (policy.forceUpdate) requestUpdaterModalOpen('auto-force', info)
  }
  catch {
    if (requestId !== policyRequestId) return

    /** 失败不改变上一份强更判定，避免轮询抖动给锁定弹窗打开逃生口。 */
    setState({ policyTitle: '', policyNotes: '' })
  }
}

/** 只在开发环境挂载中性的 DevTools 调试句柄。 */
function exposeUpdaterDebugHandle(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return

  const handle: UpdaterDebugHandle = {
    error(code = 'network') {
      setState({ status: 'error', error: normalizeErrorCode(code), modalOpen: true })
    },
    status(status) {
      setState({ status, modalOpen: true })
    },
    force(on = true) {
      setState({ forceUpdate: on, status: 'available', modalOpen: true })
    },
    codes: UPDATE_ERROR_CODES,
  }
  ;(window as Window & { $updater?: UpdaterDebugHandle }).$updater = handle
}

type UpdaterDebugHandle = {
  error: (code?: string) => void
  status: (status: UpdaterStatus) => void
  force: (on?: boolean) => void
  codes: typeof UPDATE_ERROR_CODES
}
