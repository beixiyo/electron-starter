import type { WindowType } from '@shared'

export const INTERNAL_HOLD_NO_WINDOW = '__INTERNAL_HOLD_NO_WINDOW__' as const

export type HoldStartConfig = {
  /** 窗口类型，可选。如果不提供，则使用内部虚拟类型 */
  type?: WindowType
  /** 松开时的回调函数，接收结果数据 */
  onRelease?: (result: unknown) => void
}

export type HoldState = {
  isHolding: boolean
  startTime: number
  windowType: WindowType | typeof INTERNAL_HOLD_NO_WINDOW
  onRelease?: (result: unknown) => void
}

export type SerializableHoldState = {
  isHolding: boolean
  startTime: number
  windowType: WindowType | typeof INTERNAL_HOLD_NO_WINDOW
}
