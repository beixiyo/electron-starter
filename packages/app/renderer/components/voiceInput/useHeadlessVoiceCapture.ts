/** 连接采集驱动与转写适配器；采集操作串行，转写不占用下一轮采集队列。 */
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import type { VoiceCaptureAdapter, VoiceInputPhase, VoiceTranscribeAdapter } from './types'

export function useHeadlessVoiceCapture(options: UseHeadlessVoiceCaptureOptions): HeadlessVoiceCapture {
  const { capture, transcribe, onResult, onError, onPhaseChange } = options
  const [phase, setPhaseState] = useState<VoiceInputPhase>('idle')
  const phaseRef = useRef<VoiceInputPhase>('idle')
  const sessionRef = useRef<CaptureSession | null>(null)
  const generationRef = useRef(0)
  const operationRef = useRef(Promise.resolve())
  const mountedRef = useRef(true)
  const adaptersRef = useRef(new Set<VoiceCaptureAdapter>())
  useEffect(() => {
    adaptersRef.current.add(capture)
  }, [capture])

  const setPhase = useLatestCallback((next: VoiceInputPhase) => {
    if (!mountedRef.current || phaseRef.current === next) return
    phaseRef.current = next
    setPhaseState(next)
    onPhaseChange?.(next)
  })

  const isCurrent = (session: CaptureSession) => mountedRef.current
    && sessionRef.current === session && !session.controller.signal.aborted

  const enqueue = useLatestCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = operationRef.current.then(operation, operation)
    operationRef.current = next.then(() => undefined, () => undefined)
    return next
  })

  const start = useLatestCallback((options: { sessionId?: string } = {}) => {
    if (!mountedRef.current || phaseRef.current !== 'idle') return Promise.resolve(null)
    const session: CaptureSession = {
      id: options.sessionId ?? String(++generationRef.current),
      capture,
      transcribe,
      controller: new AbortController(),
      deliveryVersion: 0,
    }
    sessionRef.current = session
    setPhase('recording')

    return enqueue(async () => {
      if (!isCurrent(session)) return null
      try {
        await session.capture.start({ sessionId: session.id, signal: session.controller.signal })
        if (!isCurrent(session)) {
          /** 驱动可能在取消或卸载后才取得麦克风，再清理一次迟到的资源。 */
          await session.capture.cancel?.({ sessionId: session.id })
          return null
        }
        return session.id
      }
      catch (error) {
        if (isCurrent(session)) {
          setPhase('failure')
          onError?.(toError(error, 'Unable to start voice capture'))
        }
        return null
      }
    })
  })

  const sealAudio = useLatestCallback((session: CaptureSession) => {
    session.audioPromise ??= enqueue(async () => {
      if (!isCurrent(session)) return null
      const audio = await session.capture.stop({ sessionId: session.id, signal: session.controller.signal })
      if (isCurrent(session)) session.audio = audio
      return audio
    })
    return session.audioPromise
  })

  const transcribeAudio = useLatestCallback(async (session: CaptureSession, audio: Blob, version: number) => {
    const current = () => isCurrent(session) && session.deliveryVersion === version
    try {
      const transcription = session.transcribe
        ? await session.transcribe(audio, { sessionId: session.id, signal: session.controller.signal })
        : { text: '' }
      if (!current()) return null
      const text = typeof transcription === 'string'
        ? transcription
        : transcription.text
      setPhase('result')
      onResult?.(text, session.id)
      return text
    }
    catch (error) {
      if (current()) {
        setPhase('failure')
        onError?.(toError(error, 'Unable to transcribe voice input'))
      }
      return null
    }
  })

  const stop = useLatestCallback(async () => {
    const session = sessionRef.current
    if (!session || phaseRef.current !== 'recording') return null
    const version = ++session.deliveryVersion
    setPhase('processing')
    try {
      const audio = await sealAudio(session)
      if (!audio || !isCurrent(session) || version !== session.deliveryVersion) return null
      return await transcribeAudio(session, audio, version)
    }
    catch (error) {
      if (isCurrent(session) && version === session.deliveryVersion) {
        setPhase('failure')
        onError?.(toError(error, 'Unable to stop voice capture'))
      }
      return null
    }
  })

  /** 封存本轮音频并取消正在进行的转写，供限时撤销复用；不会重新申请麦克风。 */
  const retain = useLatestCallback(async () => {
    const session = sessionRef.current
    if (!session || !['recording', 'processing', 'failure'].includes(phaseRef.current)) return false
    ++session.deliveryVersion
    setPhase('canceled')
    try {
      const audio = session.audio ?? await sealAudio(session)
      if (!audio || !isCurrent(session)) return false
      session.controller.abort()
      session.controller = new AbortController()
      return true
    }
    catch (error) {
      if (isCurrent(session)) {
        setPhase('failure')
        onError?.(toError(error, 'Unable to retain voice capture'))
      }
      return false
    }
  })

  /** 重用封存的音频和本轮冻结的转写器；迟到的前一次转写没有交付权。 */
  const resume = useLatestCallback(async () => {
    const session = sessionRef.current
    if (!session?.audio || !['canceled', 'failure', 'result'].includes(phaseRef.current)) return null
    session.controller.abort()
    session.controller = new AbortController()
    const version = ++session.deliveryVersion
    setPhase('processing')
    return transcribeAudio(session, session.audio, version)
  })

  /** 先失效身份再通知原驱动；清理错误不覆盖已经开始的新一轮。 */
  const releaseCapture = useLatestCallback((): Promise<void> => {
    const session = sessionRef.current
    sessionRef.current = null
    const generation = ++generationRef.current
    if (!session) return Promise.resolve()
    session.controller.abort()

    let cleanup: Promise<void>
    try {
      cleanup = Promise.resolve(session.capture.cancel?.({ sessionId: session.id }))
    }
    catch (error) {
      cleanup = Promise.reject(error)
    }
    const settled = cleanup.catch((error) => {
      if (mountedRef.current && generationRef.current === generation)
        onError?.(toError(error, 'Unable to cancel voice capture'))
    })
    /** 取消立即抵达驱动，新 start 则等待采集清理；转写不在这个队列内。 */
    void enqueue(() => settled)
    return settled
  })

  const cancel = useLatestCallback(async () => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'canceled') return
    const cleanup = releaseCapture()
    setPhase('canceled')
    await cleanup
  })

  const reset = useLatestCallback(() => {
    void releaseCapture()
    setPhase('idle')
  })

  const getAudioLevel = useLatestCallback(() => sessionRef.current?.capture.getAudioLevel?.() ?? 0)

  useEffect(() => {
    const adapters = adaptersRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const session = sessionRef.current
      sessionRef.current = null
      session?.controller.abort()
      if (session) {
        try {
          void Promise.resolve(session.capture.cancel?.({ sessionId: session.id })).catch(() => {})
        }
        catch {
          /** 继续销毁其余驱动，不让单个清理异常中断卸载。 */
        }
      }
      for (const adapter of adapters) {
        try {
          void Promise.resolve(adapter.destroy?.()).catch(() => {})
        }
        catch {
          /** 卸载时不把驱动清理错误重新投递给已经离场的界面。 */
        }
      }
      adapters.clear()
    }
  }, [])

  return {
    phase,
    sessionId: sessionRef.current?.id ?? null,
    start,
    stop,
    cancel,
    retain,
    resume,
    hasAudio: Boolean(sessionRef.current?.audio),
    reset,
    getAudioLevel,
  }
}

export type UseHeadlessVoiceCaptureOptions = {
  /** 当前采集驱动；一轮开始后冻结，后续替换仅用于下一轮。 */
  capture: VoiceCaptureAdapter
  transcribe?: VoiceTranscribeAdapter
  onResult?: (text: string, sessionId: string) => void
  onError?: (error: Error) => void
  onPhaseChange?: (phase: VoiceInputPhase) => void
}

export type HeadlessVoiceCapture = {
  phase: VoiceInputPhase
  sessionId: string | null
  start: (options?: { sessionId?: string }) => Promise<string | null>
  stop: () => Promise<string | null>
  cancel: () => Promise<void>
  retain: () => Promise<boolean>
  resume: () => Promise<string | null>
  hasAudio: boolean
  reset: () => void
  getAudioLevel: () => number
}

type CaptureSession = {
  id: string
  capture: VoiceCaptureAdapter
  transcribe?: VoiceTranscribeAdapter
  controller: AbortController
  deliveryVersion: number
  audio?: Blob
  audioPromise?: Promise<Blob | null>
}

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error
    ? value
    : new Error(fallback)
}
