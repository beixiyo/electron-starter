/** 语音输入目标 adapter：将控制字段和静态 Surface 组合起来。 */

import { VoiceImeSurface } from '@/windows/voice-ime/VoiceImeApp/components'
import { useVoiceImeViewport } from '@/windows/voice-ime/VoiceImeApp/hooks'
import { VOICE_IME_SIZE } from '@shared'
import { memo, useEffect } from 'react'
import type { WindowLabScene } from '../../types'
import type { WindowLabTargetAdapter, WindowLabTargetControlsProps, WindowLabTargetFrameProps } from '../types'
import { applyVoiceImePreset, DEFAULT_VOICE_IME_PREVIEW, getVoiceImeInitialSize, getVoiceImePresetId, VOICE_IME_PRESETS } from './scene'
import { useVoiceImeLabRuntime } from './useVoiceImeLabRuntime'
import { VoiceImeControls } from './VoiceImeControls'

const VoiceImeFrame = memo<WindowLabTargetFrameProps>(({ preview }) => {
  const scene = preview.scene
  const viewMode = getViewMode(scene)
  const runtime = useVoiceImeLabRuntime()
  const viewport = useVoiceImeViewport({
    initialViewMode: viewMode,
    runtime,
  })
  const { viewMode: displayedViewMode, switchView } = viewport

  useEffect(() => {
    if (displayedViewMode !== viewMode) switchView(viewMode)
  }, [displayedViewMode, switchView, viewMode])

  return (
    <div
      className={ preview.theme === 'dark'
        ? 'dark'
        : undefined }
      /** 预览 frame 与生产窗口同尺寸、同样固定；壳在里面锚到底边正中长开 */
      style={ { width: VOICE_IME_SIZE.width, height: VOICE_IME_SIZE.height } }
    >
      <VoiceImeSurface
        viewMode={ viewport.viewMode }
        size={ viewport.size }
        shadowInset={ viewport.shadowInset }
        durationLabel={ scene.kind === 'recording' && scene.state === 'transcribing'
          ? 'Processing'
          : 'Listening' }
        remainingSeconds={ scene.kind === 'recording'
          ? scene.remainingSeconds
          : null }
        isProcessing={ scene.kind === 'recording' && scene.state === 'transcribing' }
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
        /** 预览要把按钮画全：失败条的重试 / ✕、撤销条的撤销 / ✕ 都按有回调渲染 */
        onRetry={ NOOP }
        onUndo={ NOOP }
        onDismiss={ NOOP }
        onMeasure={ viewport.reportContentWidth }
      />
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

function getViewMode(scene: WindowLabScene): 'recording' | 'prompt' | 'canceled' | 'failure' | 'result' {
  return scene.kind
}

function NOOP(): void {}

export type VoiceImeControlsProps = WindowLabTargetControlsProps

export { VoiceImeControls }
