/** 浮层形态、内容测量与透明窗口命中区的统一编排。 */
import { VOICE_IME_SHADOW_INSET, WindowType } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest } from '../../../shared'
import { VOICE_IME_HUGGING_VIEWS, VOICE_IME_RADIUS, VOICE_IME_WINDOW_SIZE } from '../constants'
import type { VoiceImeViewMode } from '../constants'

const productionRuntime: VoiceImeViewportRuntime = {
  resizeTo: async (width, height, animate) => {
    await $ipc.window.resizeTo(WindowType.VOICE_IME, width, height, animate)
  },
  hide: async () => {
    await $ipc.window.hide(WindowType.VOICE_IME)
  },
}

export function useVoiceImeViewport(options: UseVoiceImeViewportOptions = {}): VoiceImeViewport {
  const { initialViewMode = 'prompt', runtime = productionRuntime } = options
  const [viewMode, setViewMode] = useState<VoiceImeViewMode>(initialViewMode)
  const [contentWidth, setContentWidth] = useState<number | null>(null)
  const viewModeRef = useRef(initialViewMode)
  const initialResizeDoneRef = useRef(false)
  const fallbackWindowSize = VOICE_IME_WINDOW_SIZE[viewMode]
  const isHugging = VOICE_IME_HUGGING_VIEWS.includes(viewMode)

  useEffect(() => {
    if (initialResizeDoneRef.current) return
    initialResizeDoneRef.current = true
    const initialSize = VOICE_IME_WINDOW_SIZE[initialViewMode]
    void runtime.resizeTo(initialSize.width, initialSize.height, false)
  }, [initialViewMode, runtime])

  const reportContentWidth = useLatestCallback((width: number, sourceViewMode?: VoiceImeViewMode) => {
    if (!Number.isFinite(width) || width <= 0) return
    if (sourceViewMode && sourceViewMode !== viewModeRef.current) return
    if (!VOICE_IME_HUGGING_VIEWS.includes(viewModeRef.current)) return
    setContentWidth((previous) =>
      previous === width
        ? previous
        : width
    )
  })

  const switchView = useLatestCallback((next: VoiceImeViewMode) => {
    viewModeRef.current = next
    setViewMode(next)
    /** 上一形态的测宽回调可能在 mode="wait" 退场期间再次触发，先清空并标记新形态。 */
    setContentWidth(null)
    const nextSize = VOICE_IME_WINDOW_SIZE[next]
    void runtime.resizeTo(nextSize.width, nextSize.height, true)
  })

  const size = isHugging && contentWidth !== null
    ? {
      width: contentWidth + VOICE_IME_SHADOW_INSET * 2,
      height: fallbackWindowSize.height,
    }
    : fallbackWindowSize

  useEffect(() => {
    if (!isHugging || contentWidth === null) return
    void runtime.resizeTo(size.width, size.height, true)
  }, [contentWidth, isHugging, runtime, size.height, size.width])

  const hideAndReset = useLatestCallback(async () => {
    await runtime.hide()
    viewModeRef.current = 'prompt'
    setViewMode('prompt')
    setContentWidth(null)
    const nextSize = VOICE_IME_WINDOW_SIZE.prompt
    await runtime.resizeTo(nextSize.width, nextSize.height, false)
  })

  return {
    viewMode,
    /** 含透明阴影留白的完整窗口尺寸，直接交给 VoiceImeSurface。 */
    size,
    /** 兼容旧调用方：窗口尺寸与 size 保持同一份引用。 */
    windowSize: size,
    shadowInset: VOICE_IME_SHADOW_INSET,
    switchView,
    reportContentWidth,
    hideAndReset,
  }
}

/** 生产 Voice IME 的透明区域点击穿透；Window Lab 不调用，避免 Web 预览触碰 IPC。 */
export function useVoiceImeWindowHitTest(
  viewMode: VoiceImeViewMode,
  size: { width: number; height: number },
  shadowInset: number = VOICE_IME_SHADOW_INSET,
): void {
  useRoundedWindowHitTest(WindowType.VOICE_IME, () => [
    getInsetWindowHitTestRegion(shadowInset, VOICE_IME_RADIUS[viewMode], size),
  ])
}

export type VoiceImeViewportRuntime = {
  resizeTo: (width: number, height: number, animate: boolean) => void | Promise<void>
  hide: () => void | Promise<void>
}

export type UseVoiceImeViewportOptions = {
  initialViewMode?: VoiceImeViewMode
  runtime?: VoiceImeViewportRuntime
}

export type VoiceImeViewport = {
  viewMode: VoiceImeViewMode
  /** 含透明阴影留白的完整窗口尺寸；内容自适应形态按实测宽度覆盖。 */
  size: { width: number; height: number }
  windowSize: { width: number; height: number }
  shadowInset: number
  switchView: (next: VoiceImeViewMode) => void
  reportContentWidth: (width: number, sourceViewMode?: VoiceImeViewMode) => void
  hideAndReset: () => Promise<void>
}
