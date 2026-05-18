import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 录制时长管理 Hook
 * 支持暂停/继续功能
 */
export function useRecordingTimer(isRecording: boolean, isPaused: boolean) {
  const [duration, setDuration] = useState(0)
  const timerRef = useRef<number | undefined>(undefined)
  const startTimeRef = useRef<number | null>(null)
  const pausedStartTimeRef = useRef<number | null>(null)
  const totalPausedDurationRef = useRef(0)

  /**
   * 开始计时
   */
  const startTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      return
    }

    const now = Date.now()
    /** 如果是首次开始，记录开始时间 */
    if (startTimeRef.current === null) {
      startTimeRef.current = now
    }
    /** 如果是从暂停恢复，需要更新总暂停时长 */
    else if (pausedStartTimeRef.current !== null) {
      totalPausedDurationRef.current += now - pausedStartTimeRef.current
      pausedStartTimeRef.current = null
    }

    timerRef.current = window.setInterval(() => {
      if (startTimeRef.current === null) {
        return
      }
      const elapsed = Date.now() - startTimeRef.current - totalPausedDurationRef.current
      setDuration(Math.max(0, Math.floor(elapsed / 1000)))
    }, 100)
  }, [])

  /**
   * 停止计时
   */
  const stopTimer = useCallback(() => {
    if (timerRef.current === undefined) {
      return
    }
    window.clearInterval(timerRef.current)
    timerRef.current = undefined
  }, [])

  /**
   * 重置计时器
   */
  const resetTimer = useCallback(() => {
    stopTimer()
    setDuration(0)
    startTimeRef.current = null
    pausedStartTimeRef.current = null
    totalPausedDurationRef.current = 0
  }, [stopTimer])

  /**
   * 处理暂停：记录暂停开始时间
   */
  const handlePause = useCallback(() => {
    stopTimer()
    if (pausedStartTimeRef.current === null) {
      pausedStartTimeRef.current = Date.now()
    }
  }, [stopTimer])

  /** 监听录制状态变化 */
  useEffect(() => {
    if (isRecording && !isPaused) {
      /** 开始录制或从暂停恢复 */
      startTimer()
    }
    else if (isPaused) {
      /** 暂停 */
      handlePause()
    }
    else if (!isRecording) {
      /** 停止录制 */
      resetTimer()
    }
  }, [isRecording, isPaused, startTimer, handlePause, resetTimer])

  /** 组件卸载时清理 */
  useEffect(() => {
    return () => {
      stopTimer()
    }
  }, [stopTimer])

  return duration
}
