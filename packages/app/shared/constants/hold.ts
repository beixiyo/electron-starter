/**
 * 长按相关的全局配置
 */
export const HOLD_MIN_DURATION_MS = 1000

/**
 * 录音不足 1s 时的提示
 */
export const HOLD_SHORT_ERROR_MESSAGE = '录音不足 1 秒，已废弃'

/**
 * 双击快捷键判定窗口（ms）
 *
 * 两次按下间隔不超过此值视为双击。录制与运行时共用同一个值：设置页把单键录成
 * 双击的手感，必须和运行时真正触发双击的手感一致
 */
export const DOUBLE_PRESS_INTERVAL_MS = 300
