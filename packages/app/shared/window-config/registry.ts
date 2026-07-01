import { WindowType } from '../types/window'

/**
 * 声明式窗口注册表：描述业务窗口如何映射到真实 BrowserWindow 或窗口池
 */
export const LOGICAL_WINDOW_REGISTRY = {
  [WindowType.MAIN]: {
    strategy: 'dedicated',
    physicalWindow: WindowType.MAIN,
  },
  [WindowType.VOICE_IME]: {
    strategy: 'dedicated',
    physicalWindow: WindowType.VOICE_IME,
  },
  [WindowType.OAUTH]: {
    strategy: 'dedicated',
    physicalWindow: WindowType.OAUTH,
  },
  [WindowType.SELECTION]: {
    strategy: 'pool',
    pool: WindowType.UTILITY_PANEL_POOL,
    role: 'selection',
  },
  [WindowType.SHORTCUT_TEST]: {
    strategy: 'pool',
    pool: WindowType.UTILITY_PANEL_POOL,
    role: 'shortcut-test',
  },
  [WindowType.FOCUS_NATIVE]: {
    strategy: 'pool',
    pool: WindowType.UTILITY_PANEL_POOL,
    role: 'focus-native',
  },
  [WindowType.MENUBAR]: {
    strategy: 'lazy',
    physicalWindow: WindowType.MENUBAR,
  },
  [WindowType.MEETING_TOAST]: {
    strategy: 'pool',
    pool: WindowType.FLOATING_STATUS_POOL,
    role: 'meeting-toast',
  },
} as const satisfies Record<LogicalWindowType, LogicalWindowConfig>

/**
 * 启动预热只允许 dedicated 逻辑窗口。
 *
 * lazy 需要首次使用时创建；pool 逻辑窗口需要通过 logicalWindowManager acquire；
 * 物理 pool 窗口不应该被启动预热列表直接创建。
 */
export function shouldPreloadLogicalWindow(type: WindowType): boolean {
  if (!(type in LOGICAL_WINDOW_REGISTRY))
    return false

  return LOGICAL_WINDOW_REGISTRY[type as LogicalWindowType].strategy === 'dedicated'
}

/**
 * 可被业务直接请求的逻辑窗口类型
 */
export type LogicalWindowType = Exclude<WindowType, PoolWindowType>

/**
 * 真实承载多个逻辑窗口的物理池窗口类型
 */
export type PoolWindowType
  = | WindowType.FLOATING_STATUS_POOL
    | WindowType.UTILITY_PANEL_POOL

/**
 * 已接入窗口池的逻辑窗口类型
 */
export type PooledLogicalWindowType
  = | WindowType.MEETING_TOAST
    | WindowType.SELECTION
    | WindowType.SHORTCUT_TEST
    | WindowType.FOCUS_NATIVE

/**
 * 窗口池 renderer 内部要渲染的业务组件角色
 */
export type PoolWindowRole
  = | 'meeting-toast'
    | 'selection'
    | 'shortcut-test'
    | 'focus-native'

/**
 * 逻辑窗口调度策略
 */
export type LogicalWindowStrategy
  = | 'dedicated'
    | 'pool'
    | 'lazy'

/**
 * 逻辑窗口声明项
 */
export type LogicalWindowConfig
  = | {
    strategy: 'dedicated' | 'lazy'
    physicalWindow: LogicalWindowType
  }
  | {
    strategy: 'pool'
    pool: PoolWindowType
    role: PoolWindowRole
  }

/**
 * 主进程发送给窗口池 renderer 的路由信息
 */
export type LogicalWindowRoute = {
  logicalType: PooledLogicalWindowType
  poolType: PoolWindowType
  role: PoolWindowRole
  token: number
  payload?: unknown
}
