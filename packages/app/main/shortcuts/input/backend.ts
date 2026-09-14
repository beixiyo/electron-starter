/** 键盘捕获后端契约：所有系统级输入源（uIOhook、macOS native helper）统一实现的接口 */

import type { KeyboardInput } from '@shared/shortcuts'

/** 已实现的后端标识 */
export type KeyboardInputBackendId = 'uiohook' | 'native-mac'

export type KeyboardInputListener = (input: KeyboardInput) => void

/**
 * 键盘捕获后端
 *
 * 只负责把系统输入归一成 {@link KeyboardInput} 并管理底层资源生命周期；chord、手势、
 * scope 与 action 全部由上层决定。消费者用引用计数声明需求，后端自行决定
 * 底层捕获何时真正启停
 */
export type KeyboardInputBackend = {
  readonly id: KeyboardInputBackendId
  /** 当前权限与健康状态下能否尝试捕获；每次现查，授权结果不缓存 */
  isAvailable: () => boolean
  /**
   * 声明需要输入流；首个消费者到场时启动底层捕获
   *
   * @throws 权限缺失或底层启动失败。调用方须自行降级：这一路系统级监听不可用，
   * 功能本身通常还能继续（DOM 兜底 / 无全局监听）
   */
  acquire: () => void
  /** 归还消费者计数；底层捕获是否随之停止由各后端决定 */
  release: () => void
  /** 权限或健康状态变化后按当前状态启停底层捕获 */
  sync: () => void
  /** 订阅原始输入；返回幂等的取消订阅函数 */
  subscribe: (listener: KeyboardInputListener) => () => void
  /**
   * 裸 Fn 是否归上层动作：为 true 时在系统看到之前拦下 🌐 键动作
   * （表情面板 / 切输入法 / 系统听写），Fn 组合键与 Fn 的修饰键语义不受影响
   *
   * 只有 macOS 后端有这个能力，其余平台没有 Globe 键，实现为空操作；
   * 状态由后端保留，底层捕获重启后自动重新下发
   */
  setGlobeKeySuppressed: (suppressed: boolean) => void
  /** App 退出前释放底层资源 */
  shutdown: () => void
}

/** 后端共用的订阅表 */
export function createKeyboardInputListeners(): KeyboardInputListeners {
  const listeners = new Set<KeyboardInputListener>()

  return {
    add(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    emit(input) {
      for (const listener of listeners)
        listener(input)
    },
  }
}

export type KeyboardInputListeners = {
  add: (listener: KeyboardInputListener) => () => void
  emit: (input: KeyboardInput) => void
}
