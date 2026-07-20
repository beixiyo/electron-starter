import type { InteractionState, ResizeHandle, SelectionRect } from '../types'
import { useBindWinEvent, useLatestCallback } from 'hooks'
import { useState } from 'react'
import {
  clampRectInside,
  clipRectToViewport,
  HANDLE_CURSOR,
  hitTestHandle,
  isPointInRect,
  isValidSelection,
  rectFromPoints,
  resizeRect,
} from '../utils'

/**
 * 选区交互状态机：拉新选区 / 平移 / 8 向缩放
 *
 * 拥有 selection 与 isConfirmed 两份状态，对外只暴露事件入口与派生结果，
 * 不掺任何 IPC 与业务语义 —— 换掉底图来源、换掉确认后的去向都不影响这里
 *
 * mousemove / mouseup 绑在 window 而非根元素上：拖拽中指针可能移出 overlay
 * （多屏相邻、或快速甩出边界），绑在元素上会丢 mouseup 导致选区卡在拖拽态
 */
export function useSelectionInteraction() {
  const [selection, setSelection] = useState<SelectionRect | null>(null)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [state, setState] = useState<InteractionState>({ type: 'idle' })
  const [hoverTarget, setHoverTarget] = useState<HoverTarget>(null)

  const reset = useLatestCallback(() => {
    setSelection(null)
    setIsConfirmed(false)
    setState({ type: 'idle' })
    setHoverTarget(null)
  })

  /** 按下点决定进入哪个分支：把手 → 缩放，选区内 → 平移，其余 → 重新拉框 */
  const handleMouseDown = useLatestCallback((e: React.MouseEvent) => {
    if (e.button !== 0)
      return

    const { clientX, clientY } = e

    if (isConfirmed && selection) {
      const handle = hitTestHandle(clientX, clientY, selection)
      if (handle) {
        setState({
          type: 'resizing',
          handle,
          startRect: selection,
          startX: clientX,
          startY: clientY,
        })
        return
      }

      if (isPointInRect(clientX, clientY, selection)) {
        setState({
          type: 'moving',
          offsetX: clientX - selection.x,
          offsetY: clientY - selection.y,
        })
        return
      }
    }

    setSelection(null)
    setIsConfirmed(false)
    setState({ type: 'drawing', originX: clientX, originY: clientY })
  })

  useBindWinEvent({
    eventName: 'mousemove',
    listener: (e: MouseEvent) => {
      const { clientX, clientY } = e
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      if (state.type === 'idle') {
        /** 悬停反馈只在已确认的选区上有意义，拉框途中光标恒为十字 */
        setHoverTarget(
          isConfirmed && selection
            ? hitTestHandle(clientX, clientY, selection)
            ?? (isPointInRect(clientX, clientY, selection)
              ? 'inside'
              : null)
            : null,
        )
        return
      }

      if (state.type === 'drawing') {
        setSelection(clipRectToViewport(
          rectFromPoints(state.originX, state.originY, clientX, clientY),
          viewportWidth,
          viewportHeight,
        ))
        return
      }

      if (state.type === 'moving') {
        setSelection(prev => prev && clampRectInside(
          { ...prev, x: clientX - state.offsetX, y: clientY - state.offsetY },
          viewportWidth,
          viewportHeight,
        ))
        return
      }

      setSelection(clipRectToViewport(
        resizeRect(
          state.startRect,
          state.handle,
          clientX - state.startX,
          clientY - state.startY,
        ),
        viewportWidth,
        viewportHeight,
      ))
    },
  })

  useBindWinEvent({
    eventName: 'mouseup',
    enabled: state.type !== 'idle',
    listener: () => {
      /** 拉框收尾才判定有效性：平移/缩放的结果尺寸已由 resizeRect 保底，直接保留 */
      if (state.type === 'drawing') {
        if (isValidSelection(selection))
          setIsConfirmed(true)
        else
          setSelection(null)
      }

      setState({ type: 'idle' })
    },
  })

  /** 方向键微调：平移整个选区 */
  const nudge = useLatestCallback((dx: number, dy: number) => {
    setSelection(prev => prev && clampRectInside(
      { ...prev, x: prev.x + dx, y: prev.y + dy },
      window.innerWidth,
      window.innerHeight,
    ))
  })

  /** 方向键微调：以左上角为锚点伸缩右下角 */
  const nudgeSize = useLatestCallback((dx: number, dy: number) => {
    setSelection(prev => prev && clipRectToViewport(
      resizeRect(prev, 'se', dx, dy),
      window.innerWidth,
      window.innerHeight,
    ))
  })

  const cursor = getCursor(state, hoverTarget)

  return {
    selection,
    isConfirmed,
    activeHandle: state.type === 'resizing'
      ? state.handle
      : null,
    cursor,
    handleMouseDown,
    nudge,
    nudgeSize,
    reset,
  }
}

/**
 * 光标形状：进行中的操作优先于悬停反馈
 *
 * 缩放途中指针常被甩出把手判定区，此时若按悬停算会闪回十字
 */
function getCursor(state: InteractionState, hoverTarget: HoverTarget): string {
  if (state.type === 'resizing')
    return HANDLE_CURSOR[state.handle]

  if (state.type === 'moving')
    return 'grabbing'

  if (state.type === 'drawing')
    return 'crosshair'

  if (hoverTarget === 'inside')
    return 'grab'

  if (hoverTarget)
    return HANDLE_CURSOR[hoverTarget]

  return 'crosshair'
}

/** 指针悬停命中的目标：某个把手、选区内部，或空 */
type HoverTarget = ResizeHandle | 'inside' | null
