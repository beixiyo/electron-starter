/** 浮层形态、内容测量与透明窗口命中区的统一编排。 */
import { VOICE_IME_SHADOW_INSET, WindowType } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'
import { getInsetWindowHitTestRegion, useRoundedWindowHitTest } from '../../../shared'
import { VOICE_IME_CONTENT_SIZE, VOICE_IME_HUGGING_VIEWS, VOICE_IME_RADIUS, VOICE_IME_WINDOW_SIZE } from '../constants'
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
  const size = VOICE_IME_CONTENT_SIZE[viewMode]
  const fallbackWindowSize = VOICE_IME_WINDOW_SIZE[viewMode]
  const isHugging = VOICE_IME_HUGGING_VIEWS.includes(viewMode)

  useEffect(() => {
    const initialSize = VOICE_IME_WINDOW_SIZE[initialViewMode]
    void runtime.resizeTo(initialSize.width, initialSize.height, false)
  }, [initialViewMode, runtime])

  const reportContentWidth = useLatestCallback((width: number) => {
    if (!Number.isFinite(width) || width <= 0) return
    setContentWidth((previous) =>
      previous === width
        ? previous
        : width
    )
  })

  const switchView = useLatestCallback((next: VoiceImeViewMode) => {
    setViewMode(next)
    setContentWidth(null)
    const nextSize = VOICE_IME_WINDOW_SIZE[next]
    void runtime.resizeTo(nextSize.width, nextSize.height, true)
  })

  const windowSize = isHugging && contentWidth !== null
    ? {
      width: contentWidth + VOICE_IME_SHADOW_INSET * 2,
      height: fallbackWindowSize.height,
    }
    : fallbackWindowSize

  useEffect(() => {
    if (!isHugging || contentWidth === null) return
    void runtime.resizeTo(windowSize.width, windowSize.height, true)
  }, [contentWidth, isHugging, runtime, windowSize.height, windowSize.width])

  useRoundedWindowHitTest(WindowType.VOICE_IME, () => [
    getInsetWindowHitTestRegion(VOICE_IME_SHADOW_INSET, VOICE_IME_RADIUS[viewMode], windowSize),
  ])

  const hideAndReset = useLatestCallback(async () => {
    await runtime.hide()
    setViewMode('prompt')
    setContentWidth(null)
    const nextSize = VOICE_IME_WINDOW_SIZE.prompt
    await runtime.resizeTo(nextSize.width, nextSize.height, false)
  })

  return {
    viewMode,
    size,
    windowSize,
    shadowInset: VOICE_IME_SHADOW_INSET,
    switchView,
    reportContentWidth,
    hideAndReset,
  }
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
  size: { width: number; height: number }
  windowSize: { width: number; height: number }
  shadowInset: number
  switchView: (next: VoiceImeViewMode) => void
  reportContentWidth: (width: number) => void
  hideAndReset: () => Promise<void>
}
