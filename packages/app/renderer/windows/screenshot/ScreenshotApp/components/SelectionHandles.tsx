import type { ResizeHandle, SelectionRect } from '../types'
import { memo } from 'react'
import { cn } from 'utils'
import { HANDLE_SIZE } from '../constants'
import { getHandleCenter, HANDLE_CURSOR, RESIZE_HANDLES } from '../utils'

/**
 * 8 向缩放把手
 *
 * 把手本身 `pointer-events-none`：命中判定由 useSelectionInteraction 用
 * hitTestHandle 在根元素上统一做，判定区比视觉大一圈。若让把手自己收事件，
 * 判定区就被钉死成视觉尺寸，小把手会很难抓
 */
export const SelectionHandles = memo<SelectionHandlesProps>(({
  selection,
  activeHandle,
}) => {
  return (
    <>
      {RESIZE_HANDLES.map((handle) => {
        const center = getHandleCenter(selection, handle)

        return (
          <div
            key={ handle }
            className={ cn(
              'fixed rounded-full pointer-events-none',
              'border border-text/30',
              activeHandle === handle
                ? 'bg-brand'
                : 'bg-textSpecial',
            ) }
            style={ {
              left: center.x - HANDLE_SIZE / 2,
              top: center.y - HANDLE_SIZE / 2,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              cursor: HANDLE_CURSOR[handle],
            } }
          />
        )
      })}
    </>
  )
})

SelectionHandles.displayName = 'SelectionHandles'

export type SelectionHandlesProps = {
  selection: SelectionRect
  /** 正在被拖动的把手，高亮用；无进行中的缩放时为 null */
  activeHandle: ResizeHandle | null
}
