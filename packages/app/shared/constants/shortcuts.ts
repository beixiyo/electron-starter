import { WindowType } from '../types/window'

/**
 * 全局快捷键配置
 * 统一管理主进程和渲染进程使用的快捷键
 */
export const SHORTCUTS: Shortcuts = {
  /** 长按显示 Voice IME 窗口（语音识别） */
  HOLD_VOICE_IME: {
    accelerator: 'CommandOrControl+E',
    windowType: WindowType.VOICE_IME,
  },
} as const

/**
 * 获取快捷键的 accelerator 字符串
 */
export function getShortcutAccelerator(key: keyof typeof SHORTCUTS): string {
  return SHORTCUTS[key].accelerator
}

/**
 * 获取快捷键的窗口类型
 */
export function getShortcutWindowType(key: keyof typeof SHORTCUTS): WindowType | undefined {
  return SHORTCUTS[key].windowType
}

type Shortcuts = Record<string, {
  accelerator: string
  windowType: WindowType
}>
