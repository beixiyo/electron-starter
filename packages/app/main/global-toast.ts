/** 全局提示层：主窗口不在前台时，用独立浮窗展示短提示 */

import { globalToastToRenderer } from '@ipc/services/global-toast/toRenderer'
import { getVoiceImeShellMetrics } from '@ipc/services/voice-ime/state'
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
import type { BrowserWindow } from 'electron'
import { screen } from 'electron'
import { createMainDiagnosticLogger } from './logging'
import { logicalWindowManager, windowManager } from './window-manager'

const log = createMainDiagnosticLogger('global-toast')

let currentToken = 0
let currentPayload: GlobalToastPayload | null = null
let currentPlacement: GlobalToastPlacement = 'voice-ime'
let currentOffset: number | undefined
let hideTimer: ReturnType<typeof setTimeout> | null = null
let currentAnchorWindowType = WindowType.VOICE_IME
let detachAnchorHide: (() => void) | null = null
let noticeTarget: BrowserWindow | null = null
let resolveNoticeTarget: (() => BrowserWindow | null) | null = null

/** 宿主注入可承载窗口内提示的前台窗口查询；只清理当前注册者。 */
export function setGlobalToastNoticeTargetResolver(resolve: () => BrowserWindow | null): () => void {
  resolveNoticeTarget = resolve
  return () => {
    if (resolveNoticeTarget === resolve) resolveNoticeTarget = null
  }
}

function clearAnchorWatch(): void {
  detachAnchorHide?.()
  detachAnchorHide = null
}

function watchAnchorHide(anchor: BrowserWindow | null | undefined): void {
  clearAnchorWatch()
  if (!anchor || anchor.isDestroyed() || !anchor.isVisible()) return
  const onHide = () => hideGlobalToast()
  anchor.once('hide', onHide)
  anchor.once('closed', onHide)
  detachAnchorHide = () => {
    anchor.removeListener('hide', onHide)
    anchor.removeListener('closed', onHide)
  }
}

function clearHideTimer(): void {
  if (!hideTimer) return

  clearTimeout(hideTimer)
  hideTimer = null
}

/**
 * 按可见内容计算提示窗口 bounds
 *
 * Toast 与锚定窗口的透明留白不同：各自读取配置，不能共用一份固定值
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
    const anchor = logicalWindowManager.getTargetWindow(currentAnchorWindowType)
    if (anchor && !anchor.isDestroyed() && anchor.isVisible()) {
      const bounds = anchor.getBounds()
      const gap = offset ?? GLOBAL_TOAST_GAP
      const anchorInsets = windowManager.getMetadata(currentAnchorWindowType)?.config.visibleContentInsets
      /**
       * 语音浮层的窗口固定为最大一档、壳贴着底边留白往上长（理由见 shared 的 `VOICE_IME_SIZE`），
       * 窗口顶边上方还有一大段透明区，拿它当顶边提示条会飘在胶囊上方一百多像素；
       * 只能从窗口底边减留白、再减渲染层上报的壳高。其它锚点窗仍按可见顶边算
       */
      const anchorVisibleTop = currentAnchorWindowType === WindowType.VOICE_IME
        ? bounds.y + bounds.height - (anchorInsets?.bottom ?? SHADOW_INSET) - getVoiceImeShellMetrics().height
        : bounds.y + (anchorInsets?.top ?? SHADOW_INSET)
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
    anchorWindowType = WindowType.VOICE_IME,
  } = options

  clearHideTimer()
  clearAnchorWatch()
  if (noticeTarget && !noticeTarget.isDestroyed()) globalToastToRenderer.emit('notice', null, noticeTarget)
  noticeTarget = null
  currentToken += 1
  const payload: GlobalToastPayload = { text, duration, token: currentToken }
  const target = resolveNoticeTarget?.()
  if (target && !target.isDestroyed() && target.isVisible() && target.isFocused()) {
    hideGlobalToast()
    noticeTarget = target
    globalToastToRenderer.emit('notice', payload, target)
    watchAnchorHide(target)
    return
  }

  const win = logicalWindowManager.create(WindowType.GLOBAL_TOAST)
  log.info('toast.show', 'global toast requested', {
    duration,
    placement,
    hasWindow: Boolean(win && !win.isDestroyed()),
  })
  if (!win || win.isDestroyed()) return

  /** 纯提示没有交互，鼠标事件必须穿透到用户原本操作的应用 */
  win.setIgnoreMouseEvents(true)

  currentAnchorWindowType = anchorWindowType
  currentPlacement = placement
  currentOffset = offset
  currentPayload = payload

  const bounds = resolveToastBounds(
    GLOBAL_TOAST_CONTENT_SIZE.width,
    GLOBAL_TOAST_CONTENT_SIZE.height,
    placement,
    offset,
  )
  win.setBounds(bounds)

  globalToastToRenderer.emit('render', currentPayload, win)
  logicalWindowManager.showInactive(WindowType.GLOBAL_TOAST)
  if (placement === 'voice-ime') watchAnchorHide(logicalWindowManager.getTargetWindow(anchorWindowType))

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
  clearAnchorWatch()
  if (noticeTarget && !noticeTarget.isDestroyed()) globalToastToRenderer.emit('notice', null, noticeTarget)
  noticeTarget = null

  const win = windowManager.get(WindowType.GLOBAL_TOAST)
  if (!currentPayload || !win || win.isDestroyed()) {
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
  if (!currentPayload || token !== currentToken) return

  const win = windowManager.get(WindowType.GLOBAL_TOAST)
  if (!win || win.isDestroyed()) return

  const next = resolveToastBounds(width, height, currentPlacement, currentOffset)
  win.setBounds(next)
  log.info('toast.measured', 'global toast resized to content', { width, height, bounds: next })
}
