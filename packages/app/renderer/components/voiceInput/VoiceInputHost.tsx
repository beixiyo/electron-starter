/** 宿主登记边界；窗口、输入框和浮层使用同一套 DOM 生命周期语义。 */
import { WINDOW_DATA_ATTR } from '@/windows/shared/dataAttributes'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from 'utils'
import type { VoiceInputHostInfo, VoiceInputSurface } from './types'

export function VoiceInputHost(props: VoiceInputHostProps): React.JSX.Element {
  const { hostId, surface = 'embedded', active = true, onMount, onUnmount, className, style, children, ...rest } = props
  const elementRef = useRef<HTMLDivElement | null>(null)
  const info = useMemo<VoiceInputHostInfo>(() => ({ id: hostId, surface }), [hostId, surface])

  useEffect(() => {
    if (!active || !elementRef.current) return
    onMount?.(info, elementRef.current)
    return () => onUnmount?.(info)
  }, [active, info, onMount, onUnmount])

  return (
    <div
      ref={ elementRef }
      { ...{ [WINDOW_DATA_ATTR.voiceInputHost]: hostId, [WINDOW_DATA_ATTR.voiceInputSurface]: surface } }
      className={ cn('min-w-0', className) }
      style={ style }
      { ...rest }
    >
      { children }
    </div>
  )
}

export type VoiceInputHostProps = React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>> & {
  hostId: string
  surface?: VoiceInputSurface
  active?: boolean
  onMount?: (host: VoiceInputHostInfo, element: HTMLDivElement) => void
  onUnmount?: (host: VoiceInputHostInfo) => void
}
