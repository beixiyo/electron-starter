// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 胶囊的底边光效来自 comps 源码链，测试只关心测宽与状态切换，不渲染它 */
vi.mock('comps', () => ({ BottomGlow: () => null }))

import { CanceledView } from './CanceledView'
import { RecordingView } from './RecordingView'
import { VoiceImeSurface } from './VoiceImeSurface'

describe('voice input surface measurements and expiry', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    cleanup()
  })

  it('reports intrinsic recording content width again when the status label changes', () => {
    const onMeasure = vi.fn()
    const { rerender } = render(<RecordingView onMeasure={ onMeasure } />)
    const content = screen.getByText('Listening').parentElement
    expect(content).not.toBeNull()
    Object.defineProperty(content, 'scrollWidth', { configurable: true, value: 100 })

    rerender(<RecordingView isProcessing onMeasure={ onMeasure } />)

    expect(screen.getByText('Processing')).toBeTruthy()
    expect(onMeasure).toHaveBeenLastCalledWith(156)
  })

  it('disables undo after its five second window expires', () => {
    vi.useFakeTimers()
    const expiresAt = Date.now() + 5000
    render(<CanceledView expiresAt={ expiresAt } onUndo={ vi.fn() } onDismiss={ vi.fn() } />)
    const undo = screen.getByRole('button', { name: 'Undo' })
    expect((undo as HTMLButtonElement).disabled).toBe(false)

    act(() => {
      vi.advanceTimersByTime(5100)
    })

    expect((undo as HTMLButtonElement).disabled).toBe(true)
  })

  it('uses the host copy writer and only shows success after it resolves', async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined)
    render(<VoiceImeSurface viewMode="result" text="captured text" onCopy={ onCopy } />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('captured text'))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('keeps copying available after a failed write so the user can retry', async () => {
    const onCopy = vi.fn()
      .mockRejectedValueOnce(new Error('clipboard unavailable'))
      .mockResolvedValueOnce(undefined)
    render(<VoiceImeSurface viewMode="result" text="retry me" onCopy={ onCopy } />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('waits for the previous state to leave before entering the next state', async () => {
    const { rerender } = render(<VoiceImeSurface viewMode="recording" />)
    expect(screen.getByText('Listening')).toBeTruthy()

    act(() => {
      rerender(<VoiceImeSurface viewMode="prompt" />)
    })

    expect(screen.getByText('Listening')).toBeTruthy()
    expect(screen.queryByText('Ready')).toBeNull()

    await waitFor(() => expect(screen.getByText('Ready')).toBeTruthy())
  })
})
