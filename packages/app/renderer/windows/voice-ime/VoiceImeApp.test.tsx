// @vitest-environment jsdom
/** 真实浮层装配的关闭竞态：关闭期间收到新结果必须重新显示新一轮。 */

import { WindowType } from '@shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload: any) => void>>()
  const hide = vi.fn()
  const show = vi.fn(async () => ({ success: true }))
  const resizeTo = vi.fn(async () => ({ success: true }))
  const setIgnoreMouseEvents = vi.fn(async () => ({ success: true }))

  return {
    listeners,
    hide,
    show,
    resizeTo,
    setIgnoreMouseEvents,
    emit(name: string, payload: unknown) {
      for (const listener of listeners.get(name) ?? []) listener(payload)
    },
    voiceIme: {
      on(name: string, listener: (payload: unknown) => void) {
        const current = listeners.get(name) ?? new Set()
        current.add(listener)
        listeners.set(name, current)
        return () => current.delete(listener)
      },
      setEmbeddedHost: vi.fn(async () => ({ success: true })),
      setFocusContext: vi.fn(async () => ({ success: true })),
      startClickMode: vi.fn(async () => ({ success: true, sessionId: 'session-a' })),
      stopSession: vi.fn(async () => true),
      cancelSession: vi.fn(async () => true),
      beginTranscribing: vi.fn(async () => true),
      endSession: vi.fn(async () => true),
      markRecordingStarted: vi.fn(async () => undefined),
      releaseSession: vi.fn(async () => undefined),
      deliverTranscription: vi.fn(async () => undefined),
    },
  }
})

vi.mock('@/components/voiceInput', () => ({
  createMediaRecorderCapture: vi.fn(),
  useGlobalToastNotice: vi.fn(),
}))
vi.mock('@/hooks/useVoiceImeEscapeShield', () => ({ useVoiceImeEscapeShield: vi.fn() }))
vi.mock('@/utils/env', () => ({ isElectron: () => true }))
vi.mock('hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('hooks')>(),
  useTheme: () => ['light', vi.fn()],
}))

import { VoiceImeApp } from './VoiceImeApp'

beforeEach(() => {
  harness.listeners.clear()
  harness.hide.mockReset()
  harness.show.mockClear()
  harness.resizeTo.mockClear()
  harness.setIgnoreMouseEvents.mockClear()
  vi.stubGlobal('$ipc', {
    voiceIme: harness.voiceIme,
    window: {
      hide: harness.hide,
      show: harness.show,
      resizeTo: harness.resizeTo,
      setIgnoreMouseEvents: harness.setIgnoreMouseEvents,
    },
    globalToast: { send: vi.fn() },
    clipboard: { writeText: vi.fn(async () => ({ success: true })) },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VoiceImeApp', () => {
  it('关闭等待期间收到新结果时恢复窗口可见性并展示新结果', async () => {
    let resolveHide!: () => void
    harness.hide.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveHide = resolve
      }),
    )

    const capture = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => new Blob(['audio'])),
      cancel: vi.fn(async () => {}),
    }
    render(<VoiceImeApp capture={ capture } transcribe={ vi.fn(async () => 'unused') } />)

    act(() => harness.emit('transcription', { text: 'first', sessionId: 'session-a' }))
    await waitFor(() => expect(screen.getByText('first')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(harness.hide).toHaveBeenCalledWith(WindowType.VOICE_IME))

    act(() => harness.emit('transcription', { text: 'second', sessionId: 'session-b' }))
    await waitFor(() => expect(screen.getByText('second')).toBeTruthy())

    await act(async () => {
      resolveHide()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(harness.show).toHaveBeenCalledWith(WindowType.VOICE_IME)
      expect(screen.getByText('second')).toBeTruthy()
    })
  })
})
