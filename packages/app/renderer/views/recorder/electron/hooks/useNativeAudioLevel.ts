/** 订阅 Electron 原生录音链路推送的实时音量 */

import { useLatestCallback } from 'hooks'
import { useEffect, useRef } from 'react'

/**
 * 返回引用稳定的 0-1 音量 getter，避免约 15Hz 的 IPC 事件直接触发整页重渲染
 */
export function useNativeAudioLevel(): () => number {
  const levelRef = useRef(0)

  useEffect(() => {
    return $ipc.recording.on('audioLevelChanged', ({ level }) => {
      levelRef.current = Math.min(1, Math.max(0, level))
    })
  }, [])

  return useLatestCallback(() => levelRef.current)
}
