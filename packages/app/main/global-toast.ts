/** 全局提示层：主窗口不在前台时，用独立浮窗展示短提示 */

import { globalToastToRenderer } from '@ipc/services/global-toast/toRenderer'
import type { GlobalToastPayload, GlobalToastPlacement, ShowGlobalToastOptions } from '@shared'
import {
  GLOBAL_TOAST_CONTENT_SIZE,
  GLOBAL_TOAST_DEFAULT_DURATION,
  GLOBAL_TOAST_EDGE_OFFSET,
  GLOBAL_TOAST_GAP,
  GLOBAL_TOAST_SHADOW_INSET,
  SHADOW_INSET,
  WindowType,
} from '@shared'
import { screen } from 'electron'
import { createMainDiagnosticLogger } from './logging'
import { logicalWindowManager, windowManager } from './window-manager'

const log = createMainDiagnosticLogger('global-toast')

let currentToken = 0
let currentPayload: GlobalToastPayload | null = null
let currentPlacement: GlobalToastPlacement = 'voice-ime'
let currentOffset: number | undefined
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearHideTimer(): void {
  if (!hideTimer) return

  clearTimeout(hideTimer)
  hideTimer = null
}

/**
 * 按可见内容计算提示窗口 bounds
 *
 * Toast 与 Voice IME 的透明留白不同：前者使用 10px，后者使用共享的 30px
 * 换算始终基于两者可见边，避免窗口 bounds 对齐但实体卡片发生重叠
 */
function resolveToastBounds(
  contentWidth: number,
  contentHeight: number,
  placement: GlobalToastPlacement,
  offset?: number,
): { x: number; y: number; width: number; height: number } {
  const width = contentWidth + GLOBAL_TOAST_SHADOW_INSET * 2
  const height = contentHeight + GLOBAL_TOAST_SHADOW_INSET * 2

  const toBounds = (visibleX: number, visibleY: number) => ({
    x: Math.round(visibleX - GLOBAL_TOAST_SHADOW_INSET),
    y: Math.round(visibleY - GLOBAL_TOAST_SHADOW_INSET),
    width,
    height,
  })

  if (placement === 'voice-ime') {
    const anchor = windowManager.get(WindowType.VOICE_IME)
    if (anchor && !anchor.isDestroyed() && anchor.isVisible()) {
      const bounds = anchor.getBounds()
      const gap = offset ?? GLOBAL_TOAST_GAP
      const anchorVisibleTop = bounds.y + SHADOW_INSET
      const visibleX = bounds.x + (bounds.width - contentWidth) / 2
      const visibleY = anchorVisibleTop - gap - contentHeight

      return toBounds(visibleX, visibleY)
    }
  }

  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const edge = offset ?? GLOBAL_TOAST_EDGE_OFFSET

  const visibleX = placement.endsWith('-left')
    ? workArea.x + edge
    : placement.endsWith('-right')
    ? workArea.x + workArea.width - edge - contentWidth
    : workArea.x + (workArea.width - contentWidth) / 2

  const visibleY = placement.startsWith('top')
    ? workArea.y + edge
    : workArea.y + workArea.height - edge - contentHeight

  return toBounds(visibleX, visibleY)
}

/**
 * 显示一条全局提示
 *
 * 同一时间只保留一条；新内容会覆盖旧内容并重新计时
 */
export function showGlobalToast(options: ShowGlobalToastOptions): void {
  const {
    duration = GLOBAL_TOAST_DEFAULT_DURATION,
    placement = 'voice-ime',
    offset,
    text,
  } = options

  clearHideTimer()

  const win = logicalWindowManager.create(WindowType.GLOBAL_TOAST)
  log.info('toast.show', 'global toast requested', {
    duration,
    placement,
    hasWindow: Boolean(win && !win.isDestroyed()),
  })
  if (!win || win.isDestroyed()) return

  /** 纯提示没有交互，鼠标事件必须穿透到用户原本操作的应用 */
  win.setIgnoreMouseEvents(true)

  currentToken += 1
  currentPlacement = placement
  currentOffset = offset
  currentPayload = {
    text,
    duration,
    token: currentToken,
  }

  const bounds = resolveToastBounds(
    GLOBAL_TOAST_CONTENT_SIZE.width,
    GLOBAL_TOAST_CONTENT_SIZE.height,
    placement,
    offset,
  )
  win.setBounds(bounds)

  globalToastToRenderer.emit('render', currentPayload, win)
  logicalWindowManager.showInactive(WindowType.GLOBAL_TOAST)

  log.info('toast.shown', 'global toast presented', {
    bounds,
    visible: win.isVisible(),
  })

  if (duration > 0) {
    hideTimer = setTimeout(() => {
      hideTimer = null
      hideGlobalToast()
    }, duration)
  }
}

/** 收起当前提示；当前没有提示时为空操作 */
export function hideGlobalToast(): void {
  clearHideTimer()

  const win = windowManager.get(WindowType.GLOBAL_TOAST)
  if (!win || win.isDestroyed()) {
    currentPayload = null
    return
  }

  currentPayload = null
  globalToastToRenderer.emit('render', null, win)
  logicalWindowManager.hide(WindowType.GLOBAL_TOAST)
}

/** 懒建提示窗口挂载后读取当前内容 */
export function getCurrentGlobalToast(): GlobalToastPayload | null {
  return currentPayload
}

/** 使用 renderer 实测尺寸贴合窗口；过期 token 的结果会被丢弃 */
export function applyGlobalToastMeasurement(token: number, width: number, height: number): void {
  if (token !== currentToken) return

  const win = windowManager.get(WindowType.GLOBAL_TOAST)
  if (!win || win.isDestroyed()) return

  const next = resolveToastBounds(width, height, currentPlacement, currentOffset)
  win.setBounds(next)
  log.info('toast.measured', 'global toast resized to content', { width, height, bounds: next })
}
