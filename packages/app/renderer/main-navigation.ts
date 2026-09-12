/** 主窗口启动时接收导航意图；监听先于领取，避免首屏挂载期间丢失请求 */
import { router } from '@/router'
import { isElectron } from '@/utils/env'

let initialized = false
let unsubscribe: (() => void) | undefined

/** 只在主 renderer 生命周期中初始化一次，避免组件重挂消费掉未处理的请求 */
export function initMainNavigation(): void {
  if (initialized || !isElectron())
    return
  initialized = true

  let pending: Promise<void> = Promise.resolve()
  const receive = () => {
    /** 领取与路由守卫都串行，较早的异步导航不能覆盖较新的意图 */
    pending = pending.then(async () => {
      const path = await window.$ipc.navigation.takePendingRoute()
      if (path)
        await router.navigate(path)
    }).catch((error: unknown) => {
      console.error('[navigation] failed to open main route', error)
    })
  }
  unsubscribe = window.$ipc.navigation.on('openMainRoute', receive)
  receive()
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe?.()
    initialized = false
  })
}
