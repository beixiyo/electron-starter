/** 全局提示窗口视图：订阅主进程内容并回传可见尺寸 */

import { GlobalToastBar } from '@/components/global-toast/GlobalToastBar'
import type { GlobalToastPayload } from '@shared'
import { GLOBAL_TOAST_SHADOW_INSET } from '@shared'
import { useLatestCallback } from 'hooks'
import { memo, useEffect, useRef, useState } from 'react'

export const GlobalToastApp = memo(() => {
  const [payload, setPayload] = useState<GlobalToastPayload | null>(null)
  const measuredTokenRef = useRef<number | null>(null)

  useEffect(() => {
    const off = $ipc.globalToast.on('render', (next) => {
      measuredTokenRef.current = null
      setPayload(next)
    })

    /** 订阅后补拉，避免懒建窗口错过第一次 render 推送 */
    void $ipc.globalToast.getCurrent().then((current) => {
      if (!current) return
      setPayload((prev) => prev ?? current)
    })

    return off
  }, [])

  const reportMeasurement = useLatestCallback((node: HTMLDivElement | null) => {
    if (!node || !payload) return
    if (measuredTokenRef.current === payload.token) return

    measuredTokenRef.current = payload.token
    $ipc.globalToast.send('measured', {
      token: payload.token,
      width: Math.ceil(node.offsetWidth),
      height: Math.ceil(node.offsetHeight),
    })
  })

  if (!payload) return null

  return (
    <div style={ { padding: GLOBAL_TOAST_SHADOW_INSET } }>
      <GlobalToastBar
        key={ payload.token }
        text={ payload.text }
        measureRef={ reportMeasurement }
      />
    </div>
  )
})

GlobalToastApp.displayName = 'GlobalToastApp'
