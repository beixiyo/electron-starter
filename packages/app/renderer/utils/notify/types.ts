/**
 * 跨平台通知配置
 *
 * 设计约定：
 * - **外层**：Web 与桌面三端都支持、语义一致的通用字段
 * - **平台对象**（`mac` / `windows` / `linux` / `web`）：各平台特有字段，
 *   运行时只读取当前平台对应的对象，其余忽略（优雅降级）
 *
 * 同一字段出现在多个平台对象里（如 `actions` 同时在 `mac` 和 `windows`），
 * 表示该能力在这些系统都支持；运行时只生效当前系统那一份。
 *
 * @example
 * ```ts
 * notify({
 *   title: '下载完成',
 *   body: 'video.mp4 已保存',
 *   tag: 'download',
 *   data: { path: '/x/y.mp4' },
 *   onClick: ({ data }) => openFolder(data!.path as string),
 *
 *   mac: { subtitle: '后台任务', actions: [{ text: '打开' }], onAction: () => openFolder('/x') },
 *   windows: { urgency: 'normal', actions: [{ text: '打开' }], onAction: () => openFolder('/x') },
 *   linux: { urgency: 'low' },
 *   web: { badge: '/badge.png' },
 * })
 * ```
 */
export interface NotifyOptions {
  /** 标题（必填） */
  title: string
  /** 正文 */
  body?: string
  /**
   * 图标
   * - 桌面：本地文件的绝对路径
   * - Web：可访问的 URL
   */
  icon?: string
  /** 是否静音（不发出系统提示音） */
  silent?: boolean
  /**
   * 替换 / 分组标识
   *
   * 相同 `tag` 的新通知会替换旧通知，避免刷屏
   * （桌面映射为 `groupId`，Web 映射为 `tag`）
   */
  tag?: string
  /**
   * 是否常驻、不自动消失
   *
   * - Web：映射为 `requireInteraction`
   * - Linux / Windows：映射为 `timeoutType: 'never'`，可强制常驻
   * - macOS：`timeoutType` 在 macOS 无效，是否常驻由系统「横幅 / 提醒」通知样式设置决定，无法强制
   * @default false
   */
  requireInteraction?: boolean
  /** 透传的业务数据，会原样回传给各事件回调的 `ctx.data` */
  data?: NotifyData

  /** 通知成功展示时触发 */
  onShow?: (ctx: NotifyEventCtx) => void
  /** 用户点击通知主体时触发 */
  onClick?: (ctx: NotifyEventCtx) => void
  /** 通知关闭时触发 */
  onClose?: (ctx: NotifyEventCtx) => void
  /** 创建 / 展示失败，或无通知权限时触发 */
  onError?: (ctx: NotifyEventCtx) => void

  /** macOS 特有配置，仅在 macOS 桌面端生效 */
  mac?: MacNotifyOptions
  /** Windows 特有配置，仅在 Windows 桌面端生效 */
  windows?: WindowsNotifyOptions
  /** Linux 特有配置，仅在 Linux 桌面端生效 */
  linux?: LinuxNotifyOptions
  /** Web 特有配置，仅在浏览器环境生效 */
  web?: WebNotifyOptions
}

/** macOS 通知特有配置 */
export interface MacNotifyOptions {
  /** 副标题（显示在标题下方） */
  subtitle?: string
  /** 自定义提示音名 */
  sound?: string
  /** 自定义关闭按钮文案 */
  closeButtonText?: string
  /** 操作按钮 */
  actions?: NotifyAction[]
  /**
   * 用户点击操作按钮时触发
   * @param index 被点击按钮在 `actions` 中的下标
   */
  onAction?: (index: number, ctx: NotifyEventCtx) => void
  /** 启用内联回复输入框 */
  reply?: NotifyReply
  /** 用户提交内联回复时触发 */
  onReply?: (text: string, ctx: NotifyEventCtx) => void
}

/** Windows 通知特有配置 */
export interface WindowsNotifyOptions {
  /** 紧急程度（影响在操作中心的排序） */
  urgency?: NotifyUrgency
  /** 超时策略（`never` 为常驻不自动消失） */
  timeoutType?: NotifyTimeoutType
  /** 操作按钮 */
  actions?: NotifyAction[]
  /**
   * 用户点击操作按钮时触发
   * @param index 被点击按钮在 `actions` 中的下标
   */
  onAction?: (index: number, ctx: NotifyEventCtx) => void
  /** 启用内联回复输入框 */
  reply?: NotifyReply
  /** 用户提交内联回复时触发 */
  onReply?: (text: string, ctx: NotifyEventCtx) => void
}

/** Linux 通知特有配置 */
export interface LinuxNotifyOptions {
  /** 紧急程度 */
  urgency?: NotifyUrgency
  /** 超时策略（`never` 为常驻不自动消失） */
  timeoutType?: NotifyTimeoutType
}

/** Web 通知特有配置（多为非标准 / 移动端能力，支持度因浏览器而异） */
export interface WebNotifyOptions {
  /** 角标图，部分浏览器 / 移动端使用 */
  badge?: string
  /** 大图（非标准，Chrome 支持） */
  image?: string
  /** 文字方向 */
  dir?: 'auto' | 'ltr' | 'rtl'
  /** 语言（BCP 47） */
  lang?: string
  /** 相同 `tag` 替换时是否重新提醒（需配合 `tag`） */
  renotify?: boolean
  /** 震动模式（毫秒数组），仅移动端 */
  vibrate?: number | number[]
}

/** 操作按钮 */
export interface NotifyAction {
  text: string
}

/** 内联回复配置 */
export interface NotifyReply {
  /** 输入框占位文案 */
  placeholder?: string
}

/** 紧急程度 */
export type NotifyUrgency = 'normal' | 'critical' | 'low'

/** 超时策略 */
export type NotifyTimeoutType = 'default' | 'never'

/** 业务数据透传类型 */
export type NotifyData = Record<string, unknown>

/** 事件回调上下文 */
export interface NotifyEventCtx {
  /** 创建时传入的 `tag` */
  tag?: string
  /** 创建时传入的 `data` */
  data?: NotifyData
}

/** 一条通知的操作句柄 */
export interface NotifyHandle {
  /** 主动关闭该通知 */
  close: () => void
}
