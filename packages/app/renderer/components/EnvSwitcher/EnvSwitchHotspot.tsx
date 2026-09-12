import { isElectron, isMac } from '@/utils/env'
import { memo, useState } from 'react'
import { EnvSwitchPanel } from './EnvSwitchPanel'
import { useMultiTapTrigger } from './useMultiTapTrigger'

const HOTSPOT_WIDTH = 400
const HOTSPOT_HEIGHT = 40
const TAP_COUNT = 7

/**
 * 顶部居中的隐藏入口。连续点击七次后打开环境面板；旁听逻辑不会消费原点击
 */
export const EnvSwitchHotspot = memo<EnvSwitchHotspotProps>((props) => {
  const { className, style } = props
  const [isOpen, setIsOpen] = useState(false)
  const taps = useMultiTapTrigger({
    width: HOTSPOT_WIDTH,
    height: HOTSPOT_HEIGHT,
    count: TAP_COUNT,
    onTrigger: () => {
      setIsOpen(true)
      if (isElectron()) void $ipc.window.openDevTools()
    },
  })

  return (
    <>
      { isMac() && (
        <div
          aria-hidden
          className="fixed left-1/2 top-0 z-30 h-10 w-100 -translate-x-1/2 [-webkit-app-region:no-drag]"
        />
      ) }
      { taps > 0 && (
        <div
          aria-hidden
          className={ `pointer-events-none fixed left-1/2 top-1.5 z-9999 -translate-x-1/2 rounded-full bg-background2/90 px-2 py-0.5 text-[10px] tabular-nums text-text3 ${
            className ?? ''
          }` }
          style={ style }
        >
          { TAP_COUNT - taps }
        </div>
      ) }
      <EnvSwitchPanel isOpen={ isOpen } onClose={ () => setIsOpen(false) } />
    </>
  )
})

EnvSwitchHotspot.displayName = 'EnvSwitchHotspot'

export type EnvSwitchHotspotProps = Pick<React.HTMLAttributes<HTMLElement>, 'className' | 'style'>
