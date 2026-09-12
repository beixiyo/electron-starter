import type { BrowserWindow, WebContents } from 'electron'

/** 跟踪 BrowserWindow 主框架加载状态，并提供绑定窗口实例的等待接口。 */

const DEFAULT_TIMEOUT_MS = 5000

const readinessByWindow = new WeakMap<BrowserWindow, WindowReadinessState>()

/**
 * 开始跟踪一个窗口的主框架加载状态
 *
 * 应在创建 BrowserWindow 后、调用 loadURL 或 loadFile 前调用。重复调用同一窗口
 * 不会重复注册监听器；状态跟随窗口实例，不会被同类型的新窗口替换
 */
export function trackWindowReadiness(window: BrowserWindow): void {
  if (readinessByWindow.has(window)) return

  const webContents = window.isDestroyed()
    ? undefined
    : window.webContents
  const state: WindowReadinessState = {
    phase: 'loading',
    waiters: new Set(),
    webContents: webContents ?? null,
  }
  readinessByWindow.set(window, state)

  if (!webContents || webContents.isDestroyed()) {
    state.phase = 'disposed'
    return
  }

  const onStartNavigation = (
    _event: Electron.Event,
    _url: string,
    isInPlace: boolean,
    isMainFrame: boolean,
  ): void => {
    if (!isMainFrame || isInPlace || state.phase === 'disposed') return

    state.phase = 'loading'
  }

  const onFinishLoad = (): void => {
    if (state.phase === 'disposed') return

    state.phase = 'ready'
    settleWaiters(state, true)
  }

  const onFailLoad = (
    _event: Electron.Event,
    _errorCode: number,
    _errorDescription: string,
    _validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    if (!isMainFrame || state.phase === 'disposed') return

    state.phase = 'failed'
    settleWaiters(state, false)
  }

  const onClosed = (): void => {
    disposeReadiness(state)
  }

  const onWebContentsDestroyed = (): void => {
    disposeReadiness(state)
  }

  state.cleanup = () => {
    window.removeListener('closed', onClosed)
    webContents.removeListener('did-start-navigation', onStartNavigation)
    webContents.removeListener('did-finish-load', onFinishLoad)
    webContents.removeListener('did-fail-load', onFailLoad)
    webContents.removeListener('destroyed', onWebContentsDestroyed)
  }

  webContents.on('did-start-navigation', onStartNavigation)
  webContents.on('did-finish-load', onFinishLoad)
  webContents.on('did-fail-load', onFailLoad)
  webContents.once('destroyed', onWebContentsDestroyed)
  window.once('closed', onClosed)
}

/** 等待指定窗口实例的主框架加载成功；失败、关闭或超时均返回 false。 */
export function waitForWindowReady(
  window: BrowserWindow,
  options: WindowReadinessOptions = {},
): Promise<boolean> {
  let state = readinessByWindow.get(window)
  if (!state) {
    trackWindowReadiness(window)
    state = readinessByWindow.get(window)
  }

  if (!state || state.phase === 'failed' || state.phase === 'disposed') return Promise.resolve(false)

  const webContents = state.webContents
  if (window.isDestroyed() || !webContents || webContents.isDestroyed()) {
    disposeReadiness(state)
    return Promise.resolve(false)
  }

  if (state.phase === 'ready') return Promise.resolve(true)

  const trackedState = state
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  return new Promise((resolve) => {
    const waiter: ReadinessWaiter = {
      resolve,
      timer: setTimeout(() => {
        trackedState.waiters.delete(waiter)
        resolve(false)
      }, timeoutMs),
    }
    trackedState.waiters.add(waiter)
  })
}

function settleWaiters(state: WindowReadinessState, ready: boolean): void {
  for (const waiter of state.waiters) {
    clearTimeout(waiter.timer)
    waiter.resolve(ready)
  }
  state.waiters.clear()
}

function disposeReadiness(state: WindowReadinessState): void {
  if (state.phase === 'disposed') return

  state.phase = 'disposed'
  settleWaiters(state, false)
  state.cleanup?.()
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS

  return Math.max(0, timeoutMs)
}

type WindowReadinessPhase = 'loading' | 'ready' | 'failed' | 'disposed'

type WindowReadinessState = {
  phase: WindowReadinessPhase
  waiters: Set<ReadinessWaiter>
  webContents: WebContents | null
  cleanup?: () => void
}

type ReadinessWaiter = {
  resolve: (ready: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

/** 等待窗口主框架加载成功的选项。 */
export type WindowReadinessOptions = {
  /** 最长等待时间，单位毫秒
   * @default 5000
   */
  timeoutMs?: number
}
