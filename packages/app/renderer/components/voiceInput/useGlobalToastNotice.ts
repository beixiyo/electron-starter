/** 将主进程发给前台窗口的提示转成宿主内的 TaskBanner。 */
import { isElectron } from '@/utils/env'
import type { GlobalToastPayload } from '@shared'
import { TaskBanner } from 'comps'
import type { TaskBannerNoticeController } from 'comps'
import { useEffect, useRef } from 'react'

export function useGlobalToastNotice(enabled = true): void {
  const controllerRef = useRef<TaskBannerNoticeController | null>(null)

  useEffect(() => {
    if (!enabled || !isElectron()) return

    const closeCurrent = () => {
      controllerRef.current?.close()
      controllerRef.current = null
    }

    const handleNotice = (payload: GlobalToastPayload | null) => {
      closeCurrent()
      if (!payload) return

      controllerRef.current = TaskBanner.notify({
        content: payload.text,
        duration: payload.duration,
        placement: 'top',
        showClose: false,
      })
    }

    const off = $ipc.globalToast.on('notice', handleNotice)
    return () => {
      off()
      closeCurrent()
    }
  }, [enabled])
}
