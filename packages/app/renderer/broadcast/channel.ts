import type { WindowType } from '@shared/types/window'
import type { BroadcastMessage, WindowBroadcast } from './types'

/** 从 URL query param 读取当前窗口类型 */
function getSelfWindowType(): WindowType | null {
  const params = new URLSearchParams(window.location.search)
  return (params.get('windowType') as WindowType) ?? null
}

/**
 * 创建类型安全的窗口广播通道（仅限 renderer 进程）
 *
 * @example
 * const bc = createWindowBroadcast<{ theme: string }>('theme-sync')
 *
 * // 广播到所有窗口
 * bc.post({ theme: 'dark' })
 *
 * // 仅发送到指定窗口
 * bc.post({ theme: 'dark' }, [WindowType.MAIN, WindowType.VOICE_IME])
 *
 * // 订阅（自动过滤非本窗口的定向消息）
 * const unsub = bc.on(({ payload, from }) => console.log(from, payload))
 * onUnmounted(unsub)
 */
export function createWindowBroadcast<T = unknown>(channelName: string): WindowBroadcast<T> {
  const bc = new BroadcastChannel(channelName)
  const selfType = getSelfWindowType()

  return {
    get selfType() {
      return selfType
    },

    post(payload: T, to?: WindowType[]) {
      const message: BroadcastMessage<T> = { payload, from: selfType, to }
      bc.postMessage(message)
    },

    on(callback: (message: BroadcastMessage<T>) => void) {
      const handler = (event: MessageEvent<BroadcastMessage<T>>) => {
        const msg = event.data
        /** 定向消息：本窗口无身份（URL 缺 ?windowType）或不在目标列表中时一律丢弃 */
        if (msg.to && (!selfType || !msg.to.includes(selfType)))
          return
        callback(msg)
      }

      bc.addEventListener('message', handler)
      return () => bc.removeEventListener('message', handler)
    },

    close() {
      bc.close()
    },
  }
}
