import type { LogicalWindowRoute, PooledLogicalWindowType, PoolWindowRole, PoolWindowType } from '@shared'

const routes = new Map<PoolWindowType, LogicalWindowRoute>()
let routeToken = 0

/**
 * 记录某个池窗口当前承载的逻辑窗口 route
 *
 * token 每次递增，用来区分同一个池窗口上的多次切换。renderer 可以把 token
 * 当作一次 acquire 的唯一标识，避免异步渲染或副作用误处理旧 route
 */
export function setCurrentLogicalWindowRoute(route: CreateLogicalWindowRouteOptions): LogicalWindowRoute {
  const nextRoute: LogicalWindowRoute = {
    ...route,
    token: ++routeToken,
  }

  routes.set(route.poolType, nextRoute)
  return nextRoute
}

/**
 * 获取某个池窗口当前 active route
 *
 * 返回 null 表示该池窗口当前没有被任何逻辑窗口占用；池窗口本身可能仍然存在，
 * 只是处于空状态或隐藏状态
 */
export function getCurrentLogicalWindowRoute(poolType: PoolWindowType): LogicalWindowRoute | null {
  return routes.get(poolType) ?? null
}

/**
 * 清空某个池窗口的 active route
 *
 * 这只更新主进程状态；是否通知 renderer、是否隐藏真实窗口由调用方负责
 */
export function clearCurrentLogicalWindowRoute(poolType: PoolWindowType): void {
  routes.delete(poolType)
}

/**
 * 创建 route 时所需的业务信息
 *
 * token 由 setCurrentLogicalWindowRoute 统一生成，调用方不应该自己传入，
 * 这样可以保证所有池窗口切换共享同一个单调递增序列
 */
type CreateLogicalWindowRouteOptions = {
  /**
   * 调用方请求的业务窗口类型，例如 MEETING_TOAST 或 SELECTION
   */
  logicalType: PooledLogicalWindowType
  /**
   * 实际承载该业务窗口的物理池窗口类型
   */
  poolType: PoolWindowType
  /**
   * renderer 用来选择具体 React 组件的角色
   */
  role: PoolWindowRole
  /**
   * 随 route 发送给 renderer 的业务数据
   */
  payload?: unknown
}
