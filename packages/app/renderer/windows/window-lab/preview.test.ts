import { describe, expect, it } from 'vitest'
import { isWindowLabPreview, isWindowLabPreviewMessage } from './preview'

const validPreview = {
  target: 'voice-ime' as const,
  theme: 'light' as const,
  scene: { kind: 'recording' as const, state: 'listening' as const, remainingSeconds: null },
}

describe('Window Lab iframe message boundary', () => {
  it('accepts the supported scene union and rejects legacy business-shaped payloads', () => {
    const scenes = [
      validPreview.scene,
      { kind: 'recording', state: 'transcribing', remainingSeconds: 4 },
      { kind: 'prompt' },
      { kind: 'canceled' },
      { kind: 'failure', message: 'Unavailable', detail: 'Try again' },
      { kind: 'result', text: 'A neutral result', sourceHost: 'Editor' },
    ]

    for (const scene of scenes) {
      expect(isWindowLabPreview({ ...validPreview, scene })).toBe(true)
    }

    expect(isWindowLabPreview({
      ...validPreview,
      scene: { kind: 'recording', state: 'capture-error', remainingSeconds: null },
    })).toBe(false)
    expect(isWindowLabPreview({
      ...validPreview,
      scene: { kind: 'failure', failureCode: 'transcriptionFailed' },
    })).toBe(false)
  })

  it('only accepts a validated preview message shape', () => {
    expect(isWindowLabPreviewMessage({ type: 'window-lab:preview', preview: validPreview })).toBe(true)
    expect(isWindowLabPreviewMessage({ type: 'window-lab:size', preview: validPreview })).toBe(false)
    expect(isWindowLabPreviewMessage({ type: 'window-lab:preview', preview: { ...validPreview, theme: 'sepia' } })).toBe(false)
  })
})
