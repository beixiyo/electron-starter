import type { LogicalWindowRoute, PoolWindowType } from '@shared'
import { useEffect, useState } from 'react'

export function useLogicalWindowRoute(poolType: PoolWindowType): LogicalWindowRoute | null {
  const [route, setRoute] = useState<LogicalWindowRoute | null>(null)

  useEffect(() => {
    let disposed = false

    /**
     * 已应用过的最大 token。route / clear 共享同一条单调递增序列，用它拒绝迟到的
     * 旧更新：初始 getCurrentRoute 的异步回包与 route/clear 推送走不同 IPC 通道、
     * 无跨通道有序保证，冷启动首帧尤其容易乱序
     */
    let appliedToken = -1

    const applyRoute = (nextRoute: LogicalWindowRoute): void => {
      if (disposed || nextRoute.token <= appliedToken)
        return

      appliedToken = nextRoute.token
      setRoute(nextRoute)
    }

    const applyClear = (token: number): void => {
      if (disposed || token <= appliedToken)
        return

      appliedToken = token
      setRoute(null)
    }

    $ipc.logicalWindow.getCurrentRoute(poolType).then((currentRoute) => {
      /** 已有带 token 的推送先到（appliedToken >= 0），说明快照已过期，直接丢弃 */
      if (disposed || appliedToken >= 0 || !currentRoute)
        return

      applyRoute(currentRoute)
    })

    const cleanupRoute = $ipc.logicalWindow.on('route', (nextRoute) => {
      if (nextRoute.poolType === poolType)
        applyRoute(nextRoute)
    })

    const cleanupClear = $ipc.logicalWindow.on('clear', (event) => {
      if (event.poolType === poolType)
        applyClear(event.token)
    })

    return () => {
      disposed = true
      cleanupRoute()
      cleanupClear()
    }
  }, [poolType])

  return route
}
