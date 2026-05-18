import type { RecordingControls } from 'comps'
import { useEffect, useMemo, useRef } from 'react'

type UseLiveWaveAudioOptions = {
  /**
   * 是否应该显示 LiveWaveAudio
   */
  shouldShow: boolean
  /**
   * 是否正在录制
   */
  isRecording: boolean
  /**
   * 是否暂停
   */
  isPaused: boolean
  /**
   * 获取媒体流
   */
  getMediaStream: () => MediaStream | null
  /**
   * 错误处理回调
   */
  onError: (error: Error) => void
}

/**
 * LiveWaveAudio 相关逻辑管理 Hook
 */
export function useLiveWaveAudio(options: UseLiveWaveAudioOptions) {
  const {
    shouldShow,
    isRecording,
    isPaused,
    getMediaStream,
    onError,
  } = options

  const liveWaveControlsRef = useRef<RecordingControls | null>(null)

  /** 计算状态 */
  const liveWaveState: 'recording' | 'stop' | 'idle' = isRecording
    ? 'recording'
    : isPaused
      ? 'stop'
      : 'idle'

  /** 计算是否应该捕获音频 */
  const liveWaveCapture = shouldShow && isRecording

  /** 计算外部流 */
  const liveWaveStream = useMemo(() => {
    if (!liveWaveCapture) {
      return null
    }
    return getMediaStream()
  }, [getMediaStream, liveWaveCapture])

  const useInternalRecorder = !liveWaveStream

  /** 当需要显示且正在录制时，启动内部录制器 */
  useEffect(() => {
    if (!shouldShow || !liveWaveCapture || !useInternalRecorder) {
      return
    }
    const controller = liveWaveControlsRef.current
    if (!controller) {
      return
    }

    let cancelled = false
    controller.start()
      .catch((error) => {
        if (cancelled) {
          return
        }
        onError(error)
      })

    return () => {
      cancelled = true
      controller.stop().catch(() => { })
    }
  }, [liveWaveCapture, shouldShow, onError, useInternalRecorder])

  /** 当不需要显示时，停止内部录制器 */
  useEffect(() => {
    if (shouldShow) {
      return
    }
    liveWaveControlsRef.current?.stop().catch(() => { })
  }, [shouldShow])

  /** 组件卸载时清理 */
  useEffect(() => {
    return () => {
      liveWaveControlsRef.current?.destroy()
    }
  }, [])

  return {
    controlsRef: liveWaveControlsRef,
    state: liveWaveState,
    externalStream: liveWaveStream,
  }
}
