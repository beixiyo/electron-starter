/** 全局消息窗口测试页的状态与真实 IPC 操作 */

import { isElectron } from '@/utils/env'
import type { GlobalToastPlacement, ShowGlobalToastOptions } from '@shared'
import { useLatestCallback } from 'hooks'
import { useState } from 'react'

const DEFAULT_TEXT = '这是一条全局消息窗口测试'

export function useGlobalToastDemo() {
  const available = isElectron()
  const [text, setText] = useState(DEFAULT_TEXT)
  const [placement, setPlacement] = useState<GlobalToastPlacement>('bottom')
  const [duration, setDuration] = useState(3000)
  const [offset, setOffset] = useState(96)
  const [status, setStatus] = useState<GlobalToastDemoStatus>({
    kind: available
      ? 'idle'
      : 'unavailable',
    message: available
      ? '尚未发送创建请求'
      : '当前是 Web 模式，需在 Electron 主窗口中测试',
  })

  const updateDuration = useLatestCallback((value: number) => {
    setDuration(Math.max(0, Math.round(value)))
  })

  const updateOffset = useLatestCallback((value: number) => {
    setOffset(Math.min(240, Math.max(0, Math.round(value))))
  })

  const show = useLatestCallback((overrides: Partial<ShowGlobalToastOptions> = {}) => {
    if (!available) {
      setStatus({ kind: 'unavailable', message: '未发送：消息窗口只能由 Electron 主进程创建' })
      return
    }

    const nextText = (overrides.text ?? text).trim()
    if (!nextText) {
      setStatus({ kind: 'error', message: '未发送：请先输入消息文案' })
      return
    }

    const options: ShowGlobalToastOptions = {
      text: nextText,
      placement: overrides.placement ?? placement,
      duration: overrides.duration ?? duration,
      offset: overrides.offset ?? offset,
    }

    $ipc.globalToast.send('show', options)
    setStatus({
      kind: 'sent',
      message: `已发送创建请求 · ${formatPlacement(options.placement)} · ${formatDuration(options.duration)}`,
    })
  })

  const dismiss = useLatestCallback(() => {
    if (!available) {
      setStatus({ kind: 'unavailable', message: '未发送：当前不在 Electron 环境' })
      return
    }

    $ipc.globalToast.send('dismiss')
    setStatus({ kind: 'dismissed', message: '已发送关闭请求' })
  })

  return {
    available,
    text,
    placement,
    duration,
    offset,
    status,
    setText,
    setPlacement,
    updateDuration,
    updateOffset,
    show,
    dismiss,
  }
}

function formatPlacement(placement: GlobalToastPlacement | undefined): string {
  return PLACEMENT_LABELS[placement ?? 'voice-ime']
}

function formatDuration(duration: number | undefined): string {
  if (duration === 0) return '常驻'
  return `${duration ?? 3000} ms`
}

const PLACEMENT_LABELS: Record<GlobalToastPlacement, string> = {
  'voice-ime': '语音输入窗上方',
  top: '顶部居中',
  'top-left': '左上角',
  'top-right': '右上角',
  bottom: '底部居中',
  'bottom-left': '左下角',
  'bottom-right': '右下角',
}

export type GlobalToastDemoStatus = {
  kind: 'idle' | 'sent' | 'dismissed' | 'error' | 'unavailable'
  message: string
}
