/** 按视觉刷新节奏读取归一化音量，避免音频帧直接驱动 React 重渲染 */

import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'

const SAMPLE_INTERVAL_MS = 70

/**
 * 定时采样 0-1 音量；非活跃状态立即归零，避免画面停在上一帧
 */
export function useAudioLevel(getLevel: (() => number) | undefined, active: boolean): number {
  const [level, setLevel] = useState(0)
  const readLevel = useLatestCallback(() => getLevel?.() ?? 0)

  useEffect(() => {
    if (!active || !getLevel) {
      setLevel(0)
      return
    }

    const timer = setInterval(() => setLevel(readLevel()), SAMPLE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active, getLevel, readLevel])

  return level
}
