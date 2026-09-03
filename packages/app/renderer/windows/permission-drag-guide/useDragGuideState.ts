import type { PermissionDragGuidePayload } from '@shared'
import { useLatestCallback } from 'hooks'
import { useEffect, useState } from 'react'

/**
 * 订阅主进程推来的引导卡片状态
 *
 * 与 GlobalToast 同一个坑：窗口是懒建的，主进程推第一条 `dragGuideState` 时
 * 这个 renderer 可能还没订阅，那条推送会直接丢掉——表现就是卡片一片空白
 *
 * 顺序不能反：先订阅再补拉，两者之间到达的那条推送才不会漏；
 * 反过来（先拉后订阅）会重新打开同一个窗口期
 */
export function useDragGuideState(): PermissionDragGuidePayload | null {
  const [payload, setPayload] = useState<PermissionDragGuidePayload | null>(null)

  useEffect(() => {
    const off = $ipc.permission.on('dragGuideState', (next: PermissionDragGuidePayload) => {
      setPayload(next)
    })

    void $ipc.permission.getDragGuideState().then((current: PermissionDragGuidePayload | null) => {
      if (!current) return
      setPayload(prev => prev ?? current)
    })

    return off
  }, [])

  return payload
}

/** 卡片上的两个动作：发起原生拖拽、关闭自己 */
export function useDragGuideActions(): DragGuideActions {
  /**
   * 必须在 mousedown 时发起，不能等到 dragstart
   *
   * 真正的拖拽由主进程的 `webContents.startDrag` 接管——它往 NSPasteboard 写文件 URL，
   * 系统设置才看得见这次拖放。浏览器自己的 HTML5 拖拽全程留在本进程内，
   * 因此这里同时要阻止原生 dragstart，避免两套拖拽互相抢
   */
  const startDrag = useLatestCallback((event: React.MouseEvent) => {
    event.preventDefault()
    void $ipc.permission.dragGuideDrag()
  })

  const dismiss = useLatestCallback(() => {
    void $ipc.permission.dragGuideDismiss()
  })

  return { startDrag, dismiss }
}

export type DragGuideActions = {
  startDrag: (event: React.MouseEvent) => void
  dismiss: () => void
}
