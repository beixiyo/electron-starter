/** 将三种承载面的主进程身份、采集和补投串成同一条会话流程。 */
import { isElectron } from '@/utils/env'
import { useRouteKeepAliveEffect } from '@jl-org/react-router'
import { VOICE_IME_COUNTDOWN_START_SECONDS, VOICE_IME_MAX_RECORDING_DURATION_MS } from '@shared'
import type { VoiceImeCancelPayload, VoiceImeFloatingCommandPayload } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useRef, useState } from 'react'
import { getVoiceInputPromptMessage } from './messages'
import type { VoiceCaptureAdapter, VoiceTranscribeAdapter } from './types'
import { useHeadlessVoiceCapture } from './useHeadlessVoiceCapture'
import { useVoiceUndoWindow } from './useVoiceUndoWindow'

/** host 缺省表示独立浮窗；window 和普通输入宿主复用相同的协议。 */
export function useVoiceSession(options: VoiceSessionOptions) {
  const { host, active = true, capture, transcribe, onTranscription, onPrompt, onError, onUndoExpire } = options
  const presentRef = useRef(true)
  const disconnectRef = useRef<(() => void) | null>(null)
  const mainSessionRef = useRef<string | null>(null)
  const observedSessionRef = useRef<string | null>(null)
  const resultRevisionRef = useRef(0)
  const roundRef = useRef<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const durationRef = useRef(0)
  const supplementalRef = useRef(false)
  const [promptMessage, setPromptMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [text, setText] = useState('')
  const [completed, setCompleted] = useState(false)

  const notifyError = useLatestCallback((cause: unknown) => onError?.(asError(cause)))
  const reportError = useLatestCallback((cause: Error) => {
    setError(cause.message)
    onError?.(cause)
    const id = mainSessionRef.current
    mainSessionRef.current = null
    supplementalRef.current = true
    if (id && isElectron()) void $ipc.voiceIme.endSession(id).catch(notifyError)
  })
  const acceptText = useLatestCallback((value: string, sessionId?: string) => {
    if (sessionId && observedSessionRef.current && sessionId !== observedSessionRef.current) return
    resultRevisionRef.current += 1
    setText(value)
    onTranscription?.(value)
  })
  const pipeline = useHeadlessVoiceCapture({
    capture,
    transcribe,
    onError: reportError,
    onResult: (value, id) => void deliver(value, id),
  })
  const undoWindow = useVoiceUndoWindow<string>({
    onExpire: () => {
      reset()
      onUndoExpire?.()
    },
  })

  const deliver = useLatestCallback(async (value: string, id: string) => {
    if (roundRef.current !== id) return
    try {
      if (supplementalRef.current) {
        await $ipc.voiceIme.deliverTranscription({ text: value, sourceHost: host })
      }
      else {
        await $ipc.voiceIme.releaseSession({ sessionId: id, result: { text: value, duration: durationRef.current } })
      }
      if (roundRef.current === id) {
        mainSessionRef.current = null
        setCompleted(true)
      }
    }
    catch (cause) {
      if (roundRef.current === id) reportError(asError(cause))
    }
  })

  const reset = useLatestCallback(() => {
    const id = mainSessionRef.current
    mainSessionRef.current = null
    roundRef.current = null
    resultRevisionRef.current += 1
    startedAtRef.current = null
    supplementalRef.current = false
    undoWindow.close()
    pipeline.reset()
    setError(null)
    setPromptMessage(null)
    setText('')
    setCompleted(false)
    setRemainingSeconds(null)
    if (id && isElectron()) void $ipc.voiceIme.endSession(id).catch(notifyError)
  })

  const begin = useLatestCallback(async (command: VoiceImeFloatingCommandPayload) => {
    if (!active || !presentRef.current || roundRef.current === command.sessionId) return
    reset()
    const id = command.sessionId
    roundRef.current = id
    mainSessionRef.current = id
    const started = await pipeline.start({ sessionId: id })
    if (started !== id || roundRef.current !== id) return
    startedAtRef.current = Date.now()
    await $ipc.voiceIme.markRecordingStarted(id, startedAtRef.current).catch(reportError)
  })

  /**
   * 时长只随结果上报，不再做「录音不足 1 秒」门槛
   *
   * 实测症状：浮窗呼出后第一次按 Esc 经常没反应，要按第二次才收；Fn 按得快一点就弹「录音不足 1 秒，已废弃」
   * 根因：起点 `startedAtRef` 要等 `getUserMedia` + MediaRecorder 就绪（几百毫秒）才落，之前门槛是
   * 从这一刻再数 1 秒——Esc 落在这一秒多里就走 `reset()`：相位回 idle，浮窗把 idle 画成录音胶囊，
   * 窗口又不收，画面纹丝不动；第二次 Esc 才轮到窗口消费者去收窗。stop 那边同理，短录音被当错误
   * 边界：取消一律进撤销条、停止一律交给转写，哪怕音频几乎为空——那是转写器该处理的输入，
   * 不是会话层该拦的；主进程侧的 Fn 组合判定另有自己的阈值，与这里无关
   */
  const finish = useLatestCallback(async (command: VoiceImeFloatingCommandPayload) => {
    if (command.sessionId !== mainSessionRef.current) return
    durationRef.current = startedAtRef.current === null
      ? 0
      : Math.max(0, Date.now() - startedAtRef.current)
    await pipeline.stop()
  })

  const cancelLocally = useLatestCallback(async (payload: VoiceImeCancelPayload) => {
    const id = mainSessionRef.current
    if (!id || (payload.sessionId && payload.sessionId !== id)) return
    mainSessionRef.current = null
    supplementalRef.current = true
    durationRef.current = startedAtRef.current === null
      ? 0
      : Math.max(0, Date.now() - startedAtRef.current)
    if (payload.reason === 'escape' || payload.reason === 'user') {
      const retained = await pipeline.retain()
      if (roundRef.current === id && retained) undoWindow.open(id)
    }
    else reset()
  })

  const requestStart = useLatestCallback(async () => {
    if (!active || !isElectron() || mainSessionRef.current) return
    reset()
    if (host && host !== 'window') await $ipc.voiceIme.setFocusContext({ editable: false, embeddedHost: host })
    try {
      await $ipc.voiceIme.startClickMode()
    }
    catch (cause) {
      reportError(asError(cause))
    }
  })
  const stop = useLatestCallback(async () => {
    const id = mainSessionRef.current
    if (id) await $ipc.voiceIme.stopSession(id).catch(reportError)
  })
  const cancel = useLatestCallback(async () => {
    const id = mainSessionRef.current
    if (id) await $ipc.voiceIme.cancelSession(id).catch(reportError)
  })
  const retry = useLatestCallback(async () => {
    if (!pipeline.hasAudio || mainSessionRef.current) return
    undoWindow.close()
    setError(null)
    setCompleted(false)
    supplementalRef.current = true
    await pipeline.resume()
  })
  const undo = useLatestCallback(async () => {
    if (undoWindow.consume() !== roundRef.current) return
    await retry()
  })

  const prompt = useLatestCallback((code: string) => {
    setPromptMessage(getVoiceInputPromptMessage(code))
    onPrompt?.(code)
  })
  const connect = useLatestCallback(() => {
    if (!active || !presentRef.current || !isElectron() || disconnectRef.current) return
    /** 先订阅后登记，主进程不能选中一个尚未能接收命令的宿主。 */
    const offStart = host === undefined
      ? $ipc.voiceIme.on('floatingStart', (command) => void begin(command))
      : $ipc.voiceIme.on('embeddedStart', (command) => {
        if (command.host === host) void begin(command)
      })
    const offStop = host === undefined
      ? $ipc.voiceIme.on('floatingStop', (command) => void finish(command))
      : $ipc.voiceIme.on('embeddedStop', (command) => {
        if (command.host === host) void finish(command)
      })
    const offCancel = $ipc.voiceIme.on('cancel', (payload) => void cancelLocally(payload))
    const offText = host === undefined
      ? $ipc.voiceIme.on('transcription', (payload) => acceptText(payload.text, payload.sessionId))
      : $ipc.voiceIme.on('embeddedTranscription', (payload) => {
        if (payload.host === host) acceptText(payload.text, payload.sessionId)
      })
    const offPrompt = $ipc.voiceIme.on('blockedPrompt', (payload) => {
      if (payload.host === host) prompt(payload.code)
    })
    const offRound = $ipc.voiceIme.on('activeChanged', (snapshot) => {
      if (snapshot.sessionId) observedSessionRef.current = snapshot.sessionId
      if (snapshot.phase === 'recording' && snapshot.sessionId !== roundRef.current) reset()
    })
    if (host !== undefined) void $ipc.voiceIme.setEmbeddedHost(host, true).catch(reportError)
    disconnectRef.current = () => {
      disconnectRef.current = null
      offStart()
      offStop()
      offCancel()
      offText()
      offPrompt()
      offRound()
      reset()
      if (host !== undefined) void $ipc.voiceIme.setEmbeddedHost(host, false).catch(notifyError)
    }
  })
  useRouteKeepAliveEffect(() => {
    presentRef.current = true
    connect()
    return () => {
      presentRef.current = false
      disconnectRef.current?.()
    }
  })
  useEffect(() => {
    connect()
    return () => disconnectRef.current?.()
  }, [active, host, connect])

  const { phase: capturePhase, getAudioLevel } = pipeline
  useEffect(() => {
    if (capturePhase !== 'recording') return
    const tick = () => {
      setAudioLevel(getAudioLevel())
      const startedAt = startedAtRef.current
      if (startedAt === null) return
      const left = VOICE_IME_MAX_RECORDING_DURATION_MS - (Date.now() - startedAt)
      const seconds = Math.max(0, Math.ceil(left / 1000))
      setRemainingSeconds(
        seconds <= VOICE_IME_COUNTDOWN_START_SECONDS
          ? seconds
          : null,
      )
      if (left <= 0) void stop()
    }
    const timer = setInterval(tick, 100)
    return () => clearInterval(timer)
  }, [capturePhase, getAudioLevel, stop])

  const getResultRevision = useLatestCallback(() => resultRevisionRef.current)

  return {
    getResultRevision,
    phase: error
      ? 'failure' as const
      : pipeline.phase,
    sessionId: pipeline.sessionId,
    error,
    promptMessage,
    text,
    completed,
    audioLevel,
    remainingSeconds,
    undoExpiresAt: undoWindow.expiresAt,
    canRetry: pipeline.hasAudio,
    requestStart,
    stop,
    cancel,
    retry,
    undo,
    reset,
  }
}

/** 采集与转写由调用方提供，宿主只决定展示和结果的使用方式。 */
export type VoiceSessionOptions = {
  host?: string
  /** @default true */
  active?: boolean
  capture: VoiceCaptureAdapter
  transcribe: VoiceTranscribeAdapter
  onTranscription?: (text: string) => void
  onPrompt?: (code: string) => void
  onError?: (error: Error) => void
  /** 音频过期清理完成后，由承载面决定是否收起窗口。 */
  onUndoExpire?: () => void
}

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(String(value))
}
