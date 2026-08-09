import type { IpcContract } from '@ipc/core'

/**
 * 传给主进程创建原生通知的可序列化配置
 *
 * 不含任何回调函数：回调留在渲染进程，主进程仅通过 `id` 把交互事件回传，
 * 渲染进程按 `id` 路由到对应回调（IPC 无法传递函数）
 */
export interface NativeNotifyPayload {
  /** 关联渲染进程回调的唯一标识 */
  id: string

  title: string
  body?: string
  /** 本地图标文件的绝对路径 */
  icon?: string
  silent?: boolean
  /** 分组 / 替换标识：作为系统 `id`（相同值替换/去重已投递通知）+ `groupId`（视觉分组） */
  tag?: string
  /** 常驻不自动消失，映射到 `timeoutType: 'never'`（macOS 无效，受系统通知样式控制） */
  requireInteraction?: boolean

  /** 副标题，仅 macOS */
  subtitle?: string
  /** 紧急程度，仅 Linux / Windows */
  urgency?: NativeUrgency
  /** 超时策略，仅 Linux / Windows（`requireInteraction` 为 true 时强制为 `never`） */
  timeoutType?: NativeTimeoutType
  /** 自定义提示音名，仅 macOS */
  sound?: string
  /** 自定义关闭按钮文案，仅 macOS */
  closeButtonText?: string
  /** 是否启用内联回复输入框，仅 macOS / Windows */
  hasReply?: boolean
  /** 内联回复输入框占位文案，仅 macOS / Windows */
  replyPlaceholder?: string
  /** 操作按钮，仅 macOS / Windows */
  actions?: NativeNotifyAction[]
}

/** 原生通知的操作按钮 */
export interface NativeNotifyAction {
  text: string
}

/** 原生通知回传给渲染进程的事件类型 */
export type NativeNotifyEventType = 'show' | 'click' | 'close' | 'action' | 'reply' | 'failed'

/** 原生通知事件载荷，统一通过 `id` 与渲染进程的回调对应 */
export interface NativeNotifyEvent {
  id: string
  type: NativeNotifyEventType
  /** `type === 'action'` 时为被点击按钮的索引 */
  actionIndex?: number
  /** `type === 'reply'` 时为用户输入的文本 */
  reply?: string
  /** `type === 'close'` 时的关闭原因 */
  reason?: NativeCloseReason
  /** `type === 'failed'` 时的错误信息 */
  error?: string
}

/** 通知紧急程度 */
export type NativeUrgency = 'normal' | 'critical' | 'low'

/** 通知超时策略 */
export type NativeTimeoutType = 'default' | 'never'

/** 通知关闭原因 */
export type NativeCloseReason = 'userCanceled' | 'applicationHidden' | 'timedOut'

/**
 * 原生通知 IPC 契约
 *
 * - `mainHandle`：渲染进程发起展示 / 关闭，并查询系统是否支持
 * - `rendererOn`：主进程把通知交互（点击 / 关闭 / 操作 / 回复 等）回传渲染进程
 */
export type NotificationContract = IpcContract<{
  mainHandle: {
    /** 当前系统是否支持原生通知 */
    isSupported: () => boolean
    /** 展示一条原生通知 */
    show: (payload: NativeNotifyPayload) => void
    /** 按 id 关闭一条通知 */
    close: (id: string) => void
  }
  rendererOn: {
    event: NativeNotifyEvent
  }
}>
