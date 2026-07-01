import type { LogicalWindowRoute, PoolWindowType } from '@shared'
import { useEffect, useState } from 'react'

export function useLogicalWindowRoute(poolType: PoolWindowType): LogicalWindowRoute | null {
  const [route, setRoute] = useState<LogicalWindowRoute | null>(null)

  useEffect(() => {
    let disposed = false

    $ipc.logicalWindow.getCurrentRoute(poolType).then((currentRoute) => {
      if (!disposed)
        setRoute(currentRoute)
    })

    const cleanupRoute = $ipc.logicalWindow.on('route', (nextRoute) => {
      if (nextRoute.poolType === poolType)
        setRoute(nextRoute)
    })

    const cleanupClear = $ipc.logicalWindow.on('clear', (event) => {
      if (event.poolType === poolType)
        setRoute(null)
    })

    return () => {
      disposed = true
      cleanupRoute()
      cleanupClear()
    }
  }, [poolType])

  return route
}
