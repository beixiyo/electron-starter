/**
 * 全局提示条的落点
 *
 * `voice-ime` 会优先贴在语音输入窗上方；语音输入窗不可见时回落到底部居中
 */
export type GlobalToastPlacement =
  | 'voice-ime'
  | 'top'
  | 'top-left'
  | 'top-right'
  | 'bottom'
  | 'bottom-left'
  | 'bottom-right'

/** 弹出一条全局提示的参数 */
export type ShowGlobalToastOptions = {
  /** 已完成本地化的提示文案 */
  text: string
  /**
   * 驻留时长（毫秒），`0` 表示常驻直到被顶掉或主动收起
   * @default 3000
   */
  duration?: number
  /**
   * 落点
   * @default 'voice-ime'
   */
  placement?: GlobalToastPlacement
  /**
   * 距锚定物的距离（像素）
   *
   * `voice-ime` 下表示与语音输入窗的间距，其余位置表示与屏幕工作区边缘的距离
   */
  offset?: number
}

/** 主进程推给提示窗口的当前内容 */
export type GlobalToastPayload = {
  text: string
  /** 已由主进程归一化的驻留时长 */
  duration: number
  /** 单调递增序号，用于丢弃过期测量 */
  token: number
}

/** 默认驻留时长 */
export const GLOBAL_TOAST_DEFAULT_DURATION = 3000
