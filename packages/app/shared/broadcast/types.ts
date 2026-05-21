import type { WindowType } from '../types/window'

/**
 * 广播消息结构
 * @template T 消息 payload 类型
 */
export type BroadcastMessage<T = unknown> = {
  /** 消息内容 */
  payload: T
  /** 发送方窗口类型 */
  from: WindowType
  /**
   * 目标窗口列表，undefined 表示广播到所有窗口
   * 基于 WindowConfig 的过滤：接收方窗口类型不在列表中时自动忽略
   */
  to?: WindowType[]
}

/**
 * 窗口广播通道接口（仅限 renderer 进程使用）
 * @template T 消息 payload 类型
 */
export type WindowBroadcast<T = unknown> = {
  /** 当前窗口类型，从 URL ?windowType 读取 */
  readonly selfType: WindowType | null

  /**
   * 发送消息
   * @param payload 消息内容
   * @param to 目标窗口类型列表，不传则广播到所有窗口
   */
  post: (payload: T, to?: WindowType[]) => void

  /**
   * 订阅消息，自动过滤掉不属于本窗口的消息
   * @returns 取消订阅函数
   */
  on: (callback: (message: BroadcastMessage<T>) => void) => () => void

  /** 关闭通道，释放资源 */
  close: () => void
}
