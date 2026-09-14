/** iframe/native frame 的场景分发器。 */

import { memo } from 'react'
import { VoiceImePreviewFrame } from './targets/voice-ime/voiceImeTarget'
import type { WindowLabPreview } from './types'

export const WindowLabPreviewFrame = memo<WindowLabPreviewFrameProps>(({ preview }) => {
  return <VoiceImePreviewFrame preview={ preview } />
})

WindowLabPreviewFrame.displayName = 'WindowLabPreviewFrame'

export type WindowLabPreviewFrameProps = {
  preview: WindowLabPreview
}
