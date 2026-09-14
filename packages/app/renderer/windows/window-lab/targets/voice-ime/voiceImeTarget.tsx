/** 语音输入目标 adapter：将控制字段和静态 Surface 组合起来。 */

import { VoiceImeSurface } from '@/windows/voice-ime/VoiceImeApp/components'
import { VOICE_IME_HUGGING_VIEWS, VOICE_IME_SHADOW_INSET, VOICE_IME_WINDOW_SIZE } from '@/windows/voice-ime/VoiceImeApp/constants'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WindowLabScene, WindowLabSize } from '../../types'
import type { WindowLabTargetAdapter, WindowLabTargetControlsProps, WindowLabTargetFrameProps } from '../types'
import { getWindowLabApi } from '../../ipc'
import { applyVoiceImePreset, DEFAULT_VOICE_IME_PREVIEW, getVoiceImeInitialSize, getVoiceImePresetId, VOICE_IME_PRESETS } from './scene'
import { VoiceImeControls } from './VoiceImeControls'

const VoiceImeFrame = memo<WindowLabTargetFrameProps>(({ preview }) => {
  const scene = preview.scene
  const viewMode = getViewMode(scene)
  const [measuredContentWidth, setMeasuredContentWidth] = useState<number | null>(null)
  const size = getVoiceImeWindowSize(viewMode, measuredContentWidth)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const lastReportedSizeRef = useRef<WindowLabSize | null>(null)
  const reportContentWidth = (width: number) => {
    if (!Number.isFinite(width) || width <= 0) return
    setMeasuredContentWidth(previous => previous === width
      ? previous
      : width)
  }

  useEffect(() => {
    setMeasuredContentWidth(null)
  }, [viewMode])

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const report = () => {
      const rect = frame.getBoundingClientRect()
      const nextSize: WindowLabSize = {
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      }
      if (nextSize.width <= 0 || nextSize.height <= 0) return
      const previousSize = lastReportedSizeRef.current
      if (previousSize?.width === nextSize.width && previousSize.height === nextSize.height) return
      lastReportedSizeRef.current = nextSize

      if (window.parent === window) {
        const api = getWindowLabApi()
        if (api?.resizeSelf) {
          void Promise.resolve(api.resizeSelf(nextSize.width, nextSize.height, true)).catch(() => undefined)
        }
        return
      }

      window.parent.postMessage({
        type: 'window-lab:size',
        target: 'voice-ime',
        ...nextSize,
      }, window.location.origin)
    }

    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [scene, size.height, size.width])

  return (
    <div
      ref={ frameRef }
      className={ preview.theme === 'dark'
        ? 'dark'
        : undefined }
      style={ { width: size.width, height: size.height } }
    >
      <div className="h-full p-7.5">
        <VoiceImeSurface
          viewMode={ getViewMode(scene) }
          durationLabel={ scene.kind === 'recording' && scene.state === 'transcribing'
            ? 'Processing'
            : 'Listening' }
          remainingSeconds={ scene.kind === 'recording'
            ? scene.remainingSeconds
            : null }
          message={ scene.kind === 'failure'
            ? scene.message
            : undefined }
          detail={ scene.kind === 'failure'
            ? scene.detail
            : undefined }
          text={ scene.kind === 'result'
            ? scene.text
            : undefined }
          sourceHost={ scene.kind === 'result'
            ? scene.sourceHost
            : undefined }
          onCopy={ NOOP }
          onMeasure={ VOICE_IME_HUGGING_VIEWS.includes(viewMode)
            ? reportContentWidth
            : undefined }
        />
      </div>
    </div>
  )
})

VoiceImeFrame.displayName = 'VoiceImeFrame'

export const VoiceImePreviewFrame = VoiceImeFrame

VoiceImePreviewFrame.displayName = 'VoiceImePreviewFrame'

export const voiceImeTarget: WindowLabTargetAdapter = {
  id: 'voice-ime',
  label: 'Voice input',
  defaultPreview: DEFAULT_VOICE_IME_PREVIEW,
  presets: VOICE_IME_PRESETS,
  Controls: VoiceImeControls,
  Frame: VoiceImeFrame,
  getPresetId: getVoiceImePresetId,
  applyPreset: applyVoiceImePreset,
  getInitialSize: getVoiceImeInitialSize,
}

function getVoiceImeWindowSize(
  viewMode: 'recording' | 'prompt' | 'canceled' | 'failure' | 'result',
  measuredContentWidth: number | null,
): WindowLabSize {
  const base = VOICE_IME_WINDOW_SIZE[viewMode]
  if (!VOICE_IME_HUGGING_VIEWS.includes(viewMode) || measuredContentWidth === null) return base
  if (!Number.isFinite(measuredContentWidth) || measuredContentWidth <= 0) return base
  return {
    width: measuredContentWidth + VOICE_IME_SHADOW_INSET * 2,
    height: base.height,
  }
}

function getViewMode(scene: WindowLabScene): 'recording' | 'prompt' | 'canceled' | 'failure' | 'result' {
  return scene.kind
}

function NOOP(): void {}

export type VoiceImeControlsProps = WindowLabTargetControlsProps

export { VoiceImeControls }
