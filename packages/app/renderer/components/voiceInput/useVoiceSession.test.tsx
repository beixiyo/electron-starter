// @vitest-environment jsdom
/** 通过 IPC 指令驱动真实会话 Hook，验证身份和音频跨模块交付。 */
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { createBrowserRouter, Outlet, RouterProvider } from '@jl-org/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVoiceSession } from './useVoiceSession'

vi.mock('@/utils/env', () => ({ isElectron: () => true }))

function setup() {
  const listeners = new Map<string, Set<(payload: any) => void>>()
  const emit = (name: string, payload: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(payload)
  }
  const voiceIme = {
    on: (name: string, listener: (payload: any) => void) => {
      const list = listeners.get(name) ?? new Set()
      list.add(listener)
      listeners.set(name, list)
      return () => { list.delete(listener) }
    },
    setEmbeddedHost: vi.fn(async () => {}),
    setFocusContext: vi.fn(async () => {}),
    markRecordingStarted: vi.fn(async () => {}),
    endSession: vi.fn(async () => true),
    releaseSession: vi.fn(async () => {}),
    deliverTranscription: vi.fn(async () => {}),
  }
  vi.stubGlobal('$ipc', { voiceIme })
  const audio = new Blob(['recording'])
  const capture = { start: vi.fn(async () => {}), stop: vi.fn(async () => audio), cancel: vi.fn(async () => {}) }
  return { voiceIme, emit, capture, audio }
}

afterEach(() => vi.unstubAllGlobals())

describe('useVoiceSession', () => {
  it('主进程 stop 只完成对应宿主本轮，转写完成携带原 sessionId 释放一次', async () => {
    const { voiceIme, emit, capture, audio } = setup()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const transcribe = vi.fn(async () => 'spoken text')
    const { unmount } = renderHook(() => useVoiceSession({ host: 'editor-a', capture, transcribe }))
    await act(async () => { emit('embeddedStart', { host: 'editor-a', sessionId: 'session-a', mode: 'hold' }) })
    expect(voiceIme.markRecordingStarted).toHaveBeenCalledWith('session-a', 1000)
    now.mockReturnValue(2500)
    await act(async () => { emit('embeddedStop', { host: 'editor-b', sessionId: 'session-a', mode: 'hold' }) })
    expect(capture.stop).not.toHaveBeenCalled()
    await act(async () => { emit('embeddedStop', { host: 'editor-a', sessionId: 'session-a', mode: 'hold' }) })
    expect(transcribe).toHaveBeenCalledWith(audio, expect.objectContaining({ sessionId: 'session-a' }))
    expect(voiceIme.releaseSession).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session-a', result: { text: 'spoken text', duration: 1500 } })
    unmount()
    now.mockRestore()
  })

  it.each(['escape', 'user'])('%s 取消后撤销复用音频走补投，不重新占用或释放已经取消的主进程槽位', async (reason) => {
    const { voiceIme, emit, capture, audio } = setup()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const transcribe = vi.fn(async () => 'restored text')
    const { result, unmount } = renderHook(() => useVoiceSession({ host: 'editor-a', capture, transcribe }))
    await act(async () => { emit('embeddedStart', { host: 'editor-a', sessionId: 'session-a', mode: 'click' }) })
    now.mockReturnValue(2500)
    await act(async () => { emit('cancel', { reason, sessionId: 'session-a' }) })
    expect(result.current.undoExpiresAt).toBe(7500)
    await act(async () => { await result.current.undo() })
    await waitFor(() => expect(voiceIme.deliverTranscription).toHaveBeenCalledExactlyOnceWith({ text: 'restored text', sourceHost: 'editor-a' }))
    expect(voiceIme.releaseSession).not.toHaveBeenCalled()
    expect(capture.start).toHaveBeenCalledOnce()
    expect(transcribe).toHaveBeenCalledWith(audio, expect.anything())
    unmount()
    now.mockRestore()
  })
  it('切离缓存路由立即撤销宿主登记和采集，回到缓存页重新登记', async () => {
    const { voiceIme, emit, capture } = setup()
    window.history.replaceState(null, '', '/voice-a')
    function HostPage() {
      useVoiceSession({ host: 'cached-editor', capture, transcribe: async () => 'text' })
      return <div>Voice page</div>
    }
    const router = createBrowserRouter({
      routes: [{ path: '/voice-a', component: HostPage }, { path: '/other', component: () => <div>Other page</div> }],
      options: { cache: { limit: 2 } },
    })
    const view = render(<RouterProvider router={ router }><Outlet /></RouterProvider>)
    try {
      await waitFor(() => expect(voiceIme.setEmbeddedHost).toHaveBeenCalledWith('cached-editor', true))
      await act(async () => { emit('embeddedStart', { host: 'cached-editor', sessionId: 'cached-session', mode: 'click' }) })
      await act(async () => { await router.push('/other') })
      await waitFor(() => expect(voiceIme.setEmbeddedHost).toHaveBeenCalledWith('cached-editor', false))
      expect(capture.cancel).toHaveBeenCalledWith({ sessionId: 'cached-session' })
      expect(voiceIme.endSession).toHaveBeenCalledWith('cached-session')
      voiceIme.setEmbeddedHost.mockClear()
      await act(async () => { await router.push('/voice-a') })
      await waitFor(() => expect(voiceIme.setEmbeddedHost).toHaveBeenCalledWith('cached-editor', true))
    }
    finally {
      view.unmount()
      router.dispose()
      window.history.replaceState(null, '', '/')
    }
  })

  it('拒绝上轮迟到文本，同时接收其他采集宿主投来的当前轮结果和无身份补投', async () => {
    const { emit, capture } = setup()
    const onTranscription = vi.fn()
    const { unmount } = renderHook(() => useVoiceSession({ host: 'recipient', capture, transcribe: async () => '', onTranscription }))
    act(() => {
      emit('activeChanged', { phase: 'recording', sessionId: 'new-session' })
      emit('embeddedTranscription', { host: 'recipient', sessionId: 'old-session', text: 'stale' })
      emit('embeddedTranscription', { host: 'recipient', sessionId: 'new-session', text: 'current from another host' })
      emit('embeddedTranscription', { host: 'recipient', text: 'supplement' })
    })
    expect(onTranscription.mock.calls).toEqual([['current from another host'], ['supplement']])
    expect(capture.start).not.toHaveBeenCalled()
    unmount()
  })

})
