// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceImePreviewFrame } from './voiceImeTarget'

vi.mock('comps', () => ({
  Button: () => null,
  ButtonGroup: () => null,
  Input: () => null,
  Select: () => null,
  Textarea: () => null,
}))

const resultPreview = {
  target: 'voice-ime' as const,
  theme: 'light' as const,
  scene: { kind: 'result' as const, text: 'Static preview text', sourceHost: 'Editor' },
}

describe('Window Lab voice input preview', () => {
  afterEach(() => cleanup())

  it('keeps the result copy control side-effect free', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<VoiceImePreviewFrame preview={ resultPreview } />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).not.toHaveBeenCalled()
    return waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  })
})
