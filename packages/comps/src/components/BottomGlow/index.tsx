'use client'

import { memo, useEffect, useRef } from 'react'
import { cn } from 'utils'

const GLOW_POSITION_X_PERCENT: Record<BottomGlowPosition, number> = {
  'bottom-left': 32,
  'bottom-center': 50,
  'bottom-right': 68,
}

const GLOW_LAYERS = [
  { color: '#EB92E3', width: 140, height: 116, bottom: -68, blur: 32 },
  { color: '#FCDEFA', width: 118, height: 92, bottom: -57, blur: 28 },
  { color: '#5F7EE9', width: 92, height: 78, bottom: -54, blur: 38 },
] as const

/**
 * 容器底部动态光效
 *
 * 视觉层移植自 Flowtica 的三层椭圆光场：固定呼吸表达「正在收音」，白色亮条宽度
 * 响应外部传入的归一化音量。组件只负责渲染，不采集音频，也不持有录制生命周期
 *
 * 旧版公开参数仍然保留，调用方可以渐进迁移；新增宿主应显式传入文案，装饰性场景可传
 * `label={ null }`
 */
export const BottomGlow = memo<BottomGlowProps>((props) => {
  const {
    level,
    active = true,
    label = 'Listening...',
    minLightWidth = 0.42,
    maxLightWidth = 0.76,
    glowColor,
    glowHeight = 0.33,
    position = 'bottom-center',
    contentClassName,
    contentStyle,
    className,
    style,
    children,
    ...rest
  } = props

  const fieldRef = useRef<HTMLDivElement>(null)
  const normalizedLevel = active && Number.isFinite(level)
    ? Math.min(1, Math.max(0, level))
    : 0
  const safeMaxLightWidth = Math.min(1, Math.max(0, maxLightWidth))
  const safeMinLightWidth = Math.min(safeMaxLightWidth, Math.max(0, minLightWidth))
  const lightWidth = safeMinLightWidth + normalizedLevel * (safeMaxLightWidth - safeMinLightWidth)
  const glowXPercent = GLOW_POSITION_X_PERCENT[position]
  const heightScale = Math.min(1.8, Math.max(0.35, glowHeight / 0.33))

  useEffect(() => {
    const field = fieldRef.current
    if (!field || !active) return

    const animation = field.animate(
      [
        { opacity: 0.5 },
        { opacity: 0.7 },
        { opacity: 0.56 },
        { opacity: 0.5 },
      ],
      { duration: 6000, iterations: Number.POSITIVE_INFINITY, easing: 'ease-in-out' },
    )

    return () => animation.cancel()
  }, [active])

  const content = children ?? label

  return (
    <div
      data-vv-bottom-glow-position={ position }
      className={ cn(
        'BottomGlow @container relative isolate flex aspect-[3.28/1] w-full items-center justify-center overflow-hidden rounded-full bg-white',
        className,
      ) }
      style={ style }
      { ...rest }
    >
      <div
        ref={ fieldRef }
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 origin-bottom transition-[opacity,transform] duration-100 ease-out"
        style={ {
          opacity: active
            ? 0.75 + normalizedLevel * 0.25
            : 0,
          transform: `scale(${1 + normalizedLevel * 0.05}, ${(1 + normalizedLevel * 0.16) * heightScale})`,
        } }
      >
        { GLOW_LAYERS.map((layer, index) => (
          <span
            key={ layer.color }
            className="absolute rounded-[50%]"
            style={ {
              background: index === 0 && glowColor
                ? glowColor
                : layer.color,
              bottom: `${layer.bottom}%`,
              filter: `blur(${layer.blur}px)`,
              height: `${layer.height}%`,
              left: `${glowXPercent}%`,
              transform: 'translateX(-50%)',
              width: `${layer.width}%`,
            } }
          />
        )) }
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-1/2 h-[5.5%] origin-center rounded-[50%] bg-[linear-gradient(to_right,transparent,#fff_50%,transparent)] opacity-80 mix-blend-plus-lighter blur-[3px] transition-[opacity,transform] duration-100 ease-out"
        style={ {
          opacity: active
            ? 0.8
            : 0,
          transform: `translateX(-50%) scaleX(${
            safeMaxLightWidth > 0
              ? lightWidth / safeMaxLightWidth
              : 0
          })`,
          width: `${safeMaxLightWidth * 100}%`,
        } }
      />

      { content !== null && content !== undefined && (
        <div
          className={ cn('relative z-10 text-[clamp(1rem,10cqw,2rem)] font-medium tracking-wide text-black/55', contentClassName) }
          style={ contentStyle }
        >
          { content }
        </div>
      ) }
    </div>
  )
})

BottomGlow.displayName = 'BottomGlow'

export type BottomGlowProps = {
  /** 外部传入的归一化音量，超出 0-1 的值会在组件边界被截断 */
  level: number
  /** 是否启用动态光效；关闭时熄灭 */
  active?: boolean
  /** 默认展示文案，传入 children 时由 children 覆盖；传 null 隐藏文案 */
  label?: React.ReactNode
  /** 静音时白色亮条占组件宽度的比例 */
  minLightWidth?: number
  /** 满音量时白色亮条占组件宽度的比例 */
  maxLightWidth?: number
  /** 兼容旧版的主光晕颜色覆盖 */
  glowColor?: string
  /** 光场相对默认高度的比例标定 */
  glowHeight?: number
  /** 内容容器的 className */
  contentClassName?: string
  /** 内容容器的行内样式 */
  contentStyle?: React.CSSProperties
  /** 光效在底部的水平位置 */
  position?: BottomGlowPosition
} & React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>

export type BottomGlowPosition = 'bottom-left' | 'bottom-center' | 'bottom-right'
