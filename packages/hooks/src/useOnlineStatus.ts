import { useSyncExternalStore } from 'react'

/**
 * 订阅浏览器在线 / 离线状态
 *
 * 这里表示浏览器网络链路状态，不代表某个后端接口一定可达
 * SSR 或没有 window 的环境按在线处理
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)

  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function getSnapshot(): boolean {
  return navigator.onLine
}

function getServerSnapshot(): boolean {
  return true
}
