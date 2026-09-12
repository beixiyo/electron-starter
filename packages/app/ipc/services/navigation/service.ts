import { createIpcService } from '@ipc/core'
import { ensureMainWindowReady } from '@main/main-window-opener'
import { windowManager } from '@main/window-manager'
import { WindowType } from '@shared'
import type { MainRoute, NavigationContract } from './contract'
import { MAIN_ROUTES } from './contract'

/** 主窗口重建或首次加载期间暂存的最新路由意图。 */
let pendingRoute: MainRoute | null = null
let pendingGeneration = 0

const allowedRoutes: ReadonlySet<string> = new Set(MAIN_ROUTES)

export const navigationService = createIpcService<NavigationContract>('navigation', {
  mainHandle: {
    openMainRoute: async (_event, path: MainRoute) => ({
      success: await openMainRoute(path),
    }),
    async takePendingRoute(event) {
      assertMainWindowSender(event)
      const path = pendingRoute
      pendingRoute = null
      return path
    },
  },
})

/** 确保主窗口已加载后，向它投递一条 renderer 路由意图。 */
export async function openMainRoute(path: MainRoute): Promise<boolean> {
  if (!isMainRoute(path))
    return false

  const generation = ++pendingGeneration
  /**
   * did-finish-load 早于 React 根组件的 useEffect 订阅，事件可能无人接收；
   * 用单槽位保留最新意图，由 renderer 先订阅再调用 takePendingRoute 领取。
   */
  pendingRoute = path

  const mainWindow = await ensureMainWindowReady()
  if (!mainWindow)
    return false

  if (generation !== pendingGeneration)
    return false

  if (!windowManager.show(WindowType.MAIN))
    return false

  mainWindow.focus()
  navigationService.emit('openMainRoute', path, mainWindow)
  return true
}

function isMainRoute(path: string): path is MainRoute {
  return allowedRoutes.has(path)
}

/** 只允许主窗口 renderer 领取导航握手中的暂存意图。 */
function assertMainWindowSender(event: unknown): void {
  const senderId = (event as { sender?: { id?: number } }).sender?.id
  const mainWindow = windowManager.get(WindowType.MAIN)

  if (!mainWindow || mainWindow.isDestroyed() || senderId !== mainWindow.webContents.id)
    throw new Error('Pending navigation may only be claimed by the main window')
}
