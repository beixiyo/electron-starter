import type { IpcContract } from '@ipc/core'

/** 模板主窗口路由表；类型与 IPC 运行时校验共用同一份声明 */
export const MAIN_ROUTES = [
  '/',
  '/login',
  '/recorder',
  '/shortcuts',
  '/global-toast-test',
  '/notify-test',
  '/screenshot-test',
  '/update',
] as const

/** 主窗口可接收的路由意图，实际跳转由 renderer router 完成 */
export type MainRoute = typeof MAIN_ROUTES[number]

/** 主窗口导航请求及首屏领取协议 */
export type NavigationContract = IpcContract<{
  mainHandle: {
    /** 请求主窗口显示并跳转到指定页面。 */
    openMainRoute: (path: MainRoute) => { success: boolean }
    /** 主窗口 renderer 完成订阅后领取重建期间暂存的最新路由意图。 */
    takePendingRoute: () => MainRoute | null
  }
  rendererOn: {
    /** 主窗口 renderer 执行路由跳转。 */
    openMainRoute: MainRoute
  }
}>
