import { Message } from 'comps'
import { useLatestCallback } from 'hooks'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  disposeRecordingStore,
  ensureSystemAudioSupportChecked,
  getRecordingSourceState,
  initRecordingStore,
  pauseNativeRecording,
  resetNativeRecording,
  resumeNativeRecording,
  startNativeRecording,
  stopNativeRecording,
  useRecordingSourceState,
} from '@/store/recordingStore'
import { recorderStorage } from '../utils/storage'

/**
 * 手动 native tap 录音控制器（macOS 14.2+ 混入系统音频）
 *
 * 录音由 Swift 子进程执行、主进程 recordingState 驱动，本 hook 只：
 * - 订阅主进程状态快照（recordingStore）+ 探测支持
 * - 提供 start/pause/resume/stop/cancel（转发 IPC）
 * - 录音结束 manualRecordingComplete → 读产物存 IndexedDB（复用 recorderStorage，同会议录音）
 *
 * 引擎选择在录音页按 `systemAudioSupport && audioOnly` 决定：不支持 / 录视频时回退 web ScreenRecorder
 */
export function useNativeManualRecording(onSaved?: () => void) {
  const { t } = useTranslation('recorder')
  const { phase, elapsed, systemAudioSupport } = useRecordingSourceState()
  const handleSaved = useLatestCallback(() => onSaved?.())

  useEffect(() => {
    initRecordingStore()
    void ensureSystemAudioSupportChecked()
    return () => disposeRecordingStore()
  }, [])

  /** 录音结束：读临时产物 → 存 IndexedDB → 删临时文件 → 状态机回 idle */
  useEffect(() => {
    const unsubComplete = $ipc.recording.on('manualRecordingComplete', async (payload) => {
      try {
        const buffer = await $ipc.recording.readRecordingFile(payload.path)
        const blob = new Blob([buffer], { type: payload.mimeType })
        const { micEnabled, systemAudioMixEnabled } = getRecordingSourceState()

        await recorderStorage.saveRecord(blob, {
          name: buildRecordingName(),
          captureKind: 'audio',
          systemAudio: systemAudioMixEnabled,
          micAudio: micEnabled,
          duration: Math.round(payload.duration * 1000),
        })

        await $ipc.recording.deleteRecordingFile(payload.path)
        void resetNativeRecording()
        handleSaved()
      }
      catch (err) {
        console.error('[manual-recording] save failed:', err)
        Message.danger(t('audioSource.recordFailed'))
      }
    })

    const unsubError = $ipc.recording.on('manualRecordingError', (payload) => {
      Message.danger(payload.detail || t('audioSource.recordFailed'))
    })

    return () => {
      unsubComplete()
      unsubError()
    }
  }, [handleSaved, t])

  const isRecording = phase === 'recording'
  const isPaused = phase === 'paused'
  const isBusy = isRecording || isPaused

  const start = useCallback(() => { void startNativeRecording() }, [])
  const pause = useCallback(() => { void pauseNativeRecording() }, [])
  const resume = useCallback(() => { void resumeNativeRecording() }, [])
  const stop = useCallback(() => { void stopNativeRecording() }, [])
  const cancel = useCallback(() => { void resetNativeRecording() }, [])

  return {
    supported: systemAudioSupport === true,
    isRecording,
    isPaused,
    isBusy,
    elapsedSeconds: elapsed,
    start,
    pause,
    resume,
    stop,
    cancel,
  }
}

function buildRecordingName(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `audio_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}
