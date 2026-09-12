/** Voice IME 的焦点、宿主登记和会话目标；不依赖 IPC handler 或文本投递实现。 */

import type { VoiceImeFocusContext, VoiceImeHostId, VoiceImeHostRegistrationOptions, VoiceImeMode, VoiceImeSessionHost } from '@shared'
import type { BrowserWindow } from 'electron'

const focusContextWindows = new Map<number, { window: BrowserWindow; context: VoiceImeFocusContext }>()
const embeddedHosts = new Map<number, { window: BrowserWindow; hosts: Set<VoiceImeHostId> }>()
const windowHosts = new Map<number, BrowserWindow>()
const defaultHosts = new Map<number, { window: BrowserWindow; host: VoiceImeHostId }>()

let sessionTargetWindow: BrowserWindow | null = null
let sessionTargetHost: VoiceImeSessionHost | null = null
let sessionMode: VoiceImeMode = 'click'

/** 为 renderer 上报的窗口安装一次销毁清理，避免缓存失效窗口。 */
const trackedWindows = new Map<number, { window: BrowserWindow; remove: () => void }>()

function isAvailable(window: BrowserWindow): boolean {
  return !window.isDestroyed() && !window.webContents.isDestroyed()
}

function trackWindow(window: BrowserWindow): void {
  const id = window.webContents.id
  if (trackedWindows.has(id)) return

  const onDestroyed = (): void => {
    focusContextWindows.delete(id)
    embeddedHosts.delete(id)
    windowHosts.delete(id)
    defaultHosts.delete(id)

    if (sessionTargetWindow?.webContents.id === id) {
      sessionTargetWindow = null
      sessionTargetHost = null
    }

    trackedWindows.delete(id)
  }

  window.webContents.once('destroyed', onDestroyed)
  trackedWindows.set(id, {
    window,
    remove: () => window.webContents.removeListener('destroyed', onDestroyed),
  })
}

function getFocusedEmbeddedEntry(): { window: BrowserWindow; hosts: Set<VoiceImeHostId>; focusedHost: VoiceImeHostId | null } | null {
  for (const [id, entry] of embeddedHosts) {
    if (!isAvailable(entry.window)) {
      embeddedHosts.delete(id)
      focusContextWindows.delete(id)
      continue
    }

    if (!entry.window.isFocused()) continue

    const focusedHost = focusContextWindows.get(id)?.context.embeddedHost
    return {
      window: entry.window,
      hosts: entry.hosts,
      focusedHost: focusedHost && entry.hosts.has(focusedHost)
        ? focusedHost
        : null,
    }
  }

  return null
}

/** 保存某个窗口当前的 DOM 焦点上下文。 */
export function setVoiceImeFocusContext(window: BrowserWindow, context: VoiceImeFocusContext): void {
  if (!isAvailable(window)) return

  trackWindow(window)
  focusContextWindows.set(window.webContents.id, { window, context })
}

/** 登记或注销普通嵌入宿主；登记顺序不参与目标选择。 */
export function registerVoiceImeEmbeddedHost(
  window: BrowserWindow,
  host: VoiceImeHostId,
  active: boolean,
  options: VoiceImeHostRegistrationOptions = {},
): void {
  if (!isAvailable(window)) return

  trackWindow(window)
  const id = window.webContents.id
  const entry = embeddedHosts.get(id) ?? { window, hosts: new Set<VoiceImeHostId>() }

  if (active) {
    entry.hosts.add(host)
    if (options.default) defaultHosts.set(id, { window, host })
  }
  else {
    entry.hosts.delete(host)
    if (defaultHosts.get(id)?.host === host) defaultHosts.delete(id)
  }

  if (entry.hosts.size) embeddedHosts.set(id, entry)
  else embeddedHosts.delete(id)
}

/** 登记或注销窗口级宿主；它与普通嵌入宿主独立记账。 */
export function registerVoiceImeWindowHost(window: BrowserWindow, active: boolean): void {
  if (!isAvailable(window)) return

  trackWindow(window)
  const id = window.webContents.id
  if (active) windowHosts.set(id, window)
  else windowHosts.delete(id)
}

/** 当前窗口是否仍登记了指定宿主。 */
export function isVoiceImeWindowHostRegistered(window: BrowserWindow): boolean {
  return windowHosts.get(window.webContents.id) === window
    && isAvailable(window)
}

/** 异步门禁结束后确认冻结宿主仍在场且窗口可见。 */
export function isResolvedVoiceImeSurfaceAvailable(resolved: ResolvedVoiceImeSurface): boolean {
  if (resolved.surface === 'floating') return true
  if (!isAvailable(resolved.window)) return false
  if (typeof resolved.window.isVisible === 'function' && !resolved.window.isVisible()) return false
  return resolved.host === 'window'
    ? isVoiceImeWindowHostRegistered(resolved.window)
    : isVoiceImeHostRegistered(resolved.window, resolved.host)
}

export function isVoiceImeHostRegistered(window: BrowserWindow, host: VoiceImeHostId): boolean {
  const entry = embeddedHosts.get(window.webContents.id)
  return Boolean(entry && isAvailable(window) && entry.hosts.has(host))
}

/** 返回当前聚焦且 renderer 仍标记为可写的窗口。 */
export function getVoiceImeFocusedEditableWindow(): BrowserWindow | null {
  for (const [id, entry] of focusContextWindows) {
    if (!isAvailable(entry.window)) {
      focusContextWindows.delete(id)
      continue
    }

    if (entry.context.editable && entry.window.isFocused()) return entry.window
  }

  return null
}

/** 返回当前焦点所在的已登记嵌入宿主。 */
export function getVoiceImeFocusedEmbeddedTarget(): { window: BrowserWindow; host: VoiceImeHostId } | null {
  const entry = getFocusedEmbeddedEntry()
  return entry?.focusedHost
    ? { window: entry.window, host: entry.focusedHost }
    : null
}

/**
 * 返回当前前台窗口内的嵌入宿主
 *
 * 顺序固定为焦点宿主、冻结宿主、调用方携带的来源宿主；不使用最后登记项作为默认目标
 */
export function getVoiceImeForegroundEmbeddedTarget(
  options: { sourceHost?: VoiceImeHostId } = {},
): { window: BrowserWindow; host: VoiceImeHostId } | null {
  const entry = getFocusedEmbeddedEntry()
  if (!entry) return null

  const frozenHost = sessionTargetWindow === entry.window
      && sessionTargetHost
      && sessionTargetHost !== 'window'
      && entry.hosts.has(sessionTargetHost)
    ? sessionTargetHost
    : null
  const sourceHost = options.sourceHost && entry.hosts.has(options.sourceHost)
    ? options.sourceHost
    : null
  const defaultHost = defaultHosts.get(entry.window.webContents.id)
  const fallbackHost = defaultHost?.window === entry.window && entry.hosts.has(defaultHost.host)
    ? defaultHost.host
    : null
  const host = entry.focusedHost ?? frozenHost ?? sourceHost ?? fallbackHost

  return host
    ? { window: entry.window, host }
    : null
}

/** 返回当前聚焦的窗口级宿主。 */
export function getVoiceImeForegroundWindowHost(): BrowserWindow | null {
  for (const [id, window] of windowHosts) {
    if (!isAvailable(window)) {
      windowHosts.delete(id)
      continue
    }

    if (window.isFocused()) return window
  }

  return null
}

/** 在第一次异步门禁前冻结本轮承载面。 */
export type ResolvedVoiceImeSurface =
  | { surface: 'embedded'; window: BrowserWindow; host: VoiceImeSessionHost }
  | { surface: 'floating'; window: null; host: null }

export function resolveVoiceImeSurface(): ResolvedVoiceImeSurface {
  const focusedEmbedded = getVoiceImeFocusedEmbeddedTarget()
  if (focusedEmbedded) {
    return { surface: 'embedded', window: focusedEmbedded.window, host: focusedEmbedded.host }
  }

  const focusedWindowHost = getVoiceImeForegroundWindowHost()
  if (focusedWindowHost) {
    return { surface: 'embedded', window: focusedWindowHost, host: 'window' }
  }

  return { surface: 'floating', window: null, host: null }
}

/** 保存当前会话的嵌入目标；浮层会话不调用此方法。 */
export function freezeVoiceImeSessionTarget(window: BrowserWindow, host: VoiceImeSessionHost): void {
  if (!isAvailable(window)) return

  sessionTargetWindow = window
  sessionTargetHost = host
}

/** 清除当前会话的冻结目标。 */
export function clearVoiceImeSessionTarget(): void {
  sessionTargetWindow = null
  sessionTargetHost = null
}

export function getVoiceImeSessionHost(): VoiceImeSessionHost | null {
  return sessionTargetHost
}

export function setVoiceImeSessionMode(mode: VoiceImeMode): void {
  sessionMode = mode
}

export function getVoiceImeSessionMode(): VoiceImeMode {
  return sessionMode
}

/** 仅测试和生命周期清理使用，确保窗口追踪监听不残留。 */
export function clearVoiceImeWindowState(): void {
  for (const { remove } of trackedWindows.values()) remove()
  trackedWindows.clear()
  focusContextWindows.clear()
  embeddedHosts.clear()
  windowHosts.clear()
  defaultHosts.clear()
  clearVoiceImeSessionTarget()
}
