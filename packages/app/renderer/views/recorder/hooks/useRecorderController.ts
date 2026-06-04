import type { RecorderState } from '@jl-org/tool'
import type { DesktopSourceInfo } from '../utils/fetchDesktopSources'
import { ScreenRecorder } from '@jl-org/tool'
import { Message } from 'comps'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sanitizeFileName } from '../utils/file'
import { recorderStorage } from '../utils/storage'

type UseRecorderControllerOptions = {
  /**
   * 外部选中的桌面源
   */
  selectedSource: DesktopSourceInfo | null
}

const isAudioBlob = (blob: Blob | null) => blob?.type.startsWith('audio/') ?? false

export function useRecorderController({
  selectedSource,
}: UseRecorderControllerOptions) {
  const recorderRef = useRef<ScreenRecorder | null>(null)
  const liveVideoRef = useRef<HTMLVideoElement | null>(null)
  const liveAudioRef = useRef<HTMLAudioElement | null>(null)
  const discardRecordingRef = useRef(false)
  /**
   * 系统音频默认关闭：在 macOS 上捕获系统声音只能走屏幕捕获管线
   * （getDisplayMedia / desktopCapturer），会触发「屏幕录制」权限
   * 「仅录音」默认只录麦克风，需要系统声音时由用户显式开启
   */
  const [systemAudio, setSystemAudio] = useState(false)
  const [micAudio, setMicAudio] = useState(true)
  const [audioOnly, setAudioOnly] = useState(true)
  const [recorderState, setRecorderState] = useState<RecorderState>('idle')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const reportError = useCallback((err: unknown) => {
    const message = err instanceof Error
      ? err.message
      : String(err)
    setErrorMessage(message)
    Message.danger(message)
  }, [])

  const updatePreview = useCallback((blob: Blob | null) => {
    if (discardRecordingRef.current) {
      discardRecordingRef.current = false
      return
    }
    setRecordedBlob(blob)
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return blob
        ? URL.createObjectURL(blob)
        : ''
    })
    /** 如果有 blob，显示保存对话框 */
    if (blob) {
      const captureKind = audioOnly
        ? 'audio'
        : 'video'
      const now = new Date()
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`
      const defaultName = `${captureKind}_${dateStr}`
      setSaveName(defaultName)
      setShowSaveModal(true)
    }
  }, [audioOnly])

  useEffect(() => {
    const recorder = new ScreenRecorder({
      onStateChange: setRecorderState,
      onStop: updatePreview,
      onError: reportError,
      onStart: () => setErrorMessage(null),
    })
    recorderRef.current = recorder
    return () => {
      recorder.dispose()
    }
  }, [reportError, updatePreview])

  const syncRecorderConfig = useCallback(() => {
    if (!recorderRef.current)
      return
    recorderRef.current.updateConfig({
      systemAudio,
      micAudio: micAudio
        ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : false,
      audioOnly,
      video: !audioOnly,
      desktopSource: selectedSource
        ? { id: selectedSource.id }
        : undefined,
    })
  }, [audioOnly, micAudio, selectedSource, systemAudio])

  useEffect(() => {
    syncRecorderConfig()
  }, [syncRecorderConfig])

  useEffect(() => {
    if (!audioOnly && selectedSource && !selectedSource.canSystemAudio) {
      setSystemAudio(false)
    }
  }, [audioOnly, selectedSource])

  const start = useCallback(async () => {
    if (!recorderRef.current)
      return
    if (!audioOnly && !selectedSource) {
      reportError('请先选择需要录制的屏幕或窗口')
      return
    }
    setLoading(true)
    try {
      await recorderRef.current.start()
    }
    catch (err) {
      reportError(err)
    }
    finally {
      setLoading(false)
    }
  }, [audioOnly, reportError, selectedSource])

  const pause = useCallback(() => {
    recorderRef.current?.pause()
  }, [])

  const resume = useCallback(() => {
    recorderRef.current?.resume()
  }, [])

  const stop = useCallback(async () => {
    try {
      await recorderRef.current?.stop()
    }
    catch (err) {
      reportError(err)
    }
  }, [reportError])

  const cancel = useCallback(async () => {
    const isBusy = recorderState === 'recording' || recorderState === 'paused'
    if (!recorderRef.current || !isBusy)
      return
    discardRecordingRef.current = true
    try {
      await recorderRef.current.stop()
    }
    catch (err) {
      discardRecordingRef.current = false
      reportError(err)
    }
  }, [recorderState, reportError])

  const reset = useCallback(() => {
    setRecordedBlob(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl('')
    setShowSaveModal(false)
    setSaveName('')
  }, [previewUrl])

  const saveToIndexedDB = useCallback(async () => {
    if (!recordedBlob || !saveName.trim()) {
      return
    }

    setSaving(true)
    try {
      const captureKind = audioOnly
        ? 'audio'
        : 'video'
      await recorderStorage.saveRecord(recordedBlob, {
        name: saveName.trim(),
        captureKind,
        systemAudio,
        micAudio,
      })
      setShowSaveModal(false)
      setSaveName('')
      Message.success('保存成功')
    }
    catch (error) {
      console.error('保存录屏失败:', error)
      Message.danger('保存失败')
    }
    finally {
      setSaving(false)
    }
  }, [recordedBlob, saveName, audioOnly, systemAudio, micAudio])

  const cancelSave = useCallback(() => {
    setShowSaveModal(false)
    setSaveName('')
  }, [])

  const download = useCallback(async () => {
    if (!recordedBlob) {
      return
    }
    try {
      const buffer = await recordedBlob.arrayBuffer()
      const basename = selectedSource
        ? `${sanitizeFileName(selectedSource.name)}-${Date.now()}`
        : `capture-${Date.now()}`
      const extension = recordedBlob.type.includes('webm')
        ? 'webm'
        : recordedBlob.type.includes('video')
          ? 'mp4'
          : 'm4a'
      await $ipc.media.saveBuffer({
        buffer,
        mimeType: recordedBlob.type,
        defaultPath: `${basename}.${extension}`,
      })
    }
    catch (err) {
      reportError(err)
    }
  }, [recordedBlob, reportError, selectedSource])

  const toggleSystemAudio = useCallback(async () => {
    const previous = systemAudio
    const next = !previous
    setSystemAudio(next)
    if (!$ipc.media.toggleSystemAudio) {
      return
    }
    try {
      await $ipc.media.toggleSystemAudio({ enabled: next })
    }
    catch (err) {
      setSystemAudio(previous)
      reportError(err)
    }
  }, [reportError, systemAudio])

  const setSystemAudioFromSession = useCallback((value: boolean) => {
    setSystemAudio(value)
  }, [])

  const getMediaStream = useCallback(() => recorderRef.current?.getMediaStream() ?? null, [])

  useEffect(() => {
    return () => {
      const videoEl = liveVideoRef.current
      if (videoEl?.srcObject) {
        videoEl.srcObject = null
      }
      const audioEl = liveAudioRef.current
      if (audioEl?.srcObject) {
        audioEl.srcObject = null
      }
    }
  }, [])

  const isRecording = recorderState === 'recording'
  const isPaused = recorderState === 'paused'
  const isBusy = isRecording || isPaused
  const hasResult = Boolean(recordedBlob)
  const audioResult = isAudioBlob(recordedBlob)
  const showAudioPreview = audioOnly || audioResult
  const showVideoPreview = !showAudioPreview
  const isLiveAudioPreview = showAudioPreview && audioOnly && isBusy
  const isLiveVideoPreview = showVideoPreview && !audioOnly && isBusy
  const recordedVideoSrc = showVideoPreview && hasResult && !isLiveVideoPreview
    ? previewUrl
    : undefined
  const recordedAudioSrc = showAudioPreview && hasResult && !isLiveAudioPreview
    ? previewUrl
    : undefined
  const canControlSystemAudio = audioOnly || !!selectedSource?.canSystemAudio

  return {
    recorderState,
    systemAudio,
    micAudio,
    audioOnly,
    errorMessage,
    loading,
    recordedBlob,
    previewUrl,
    isRecording,
    isPaused,
    isBusy,
    hasResult,
    isAudioResult: audioResult,
    showAudioPreview,
    showVideoPreview,
    isLiveAudioPreview,
    isLiveVideoPreview,
    recordedVideoSrc,
    recordedAudioSrc,
    canControlSystemAudio,
    liveVideoRef,
    liveAudioRef,
    start,
    pause,
    resume,
    stop,
    cancel,
    reset,
    download,
    toggleSystemAudio,
    setMicAudio,
    setAudioOnly,
    setSystemAudioFromSession,
    reportError,
    getMediaStream,
    /** 保存到 IndexedDB 相关 */
    showSaveModal,
    saveName,
    saving,
    setSaveName,
    saveToIndexedDB,
    cancelSave,
  }
}
