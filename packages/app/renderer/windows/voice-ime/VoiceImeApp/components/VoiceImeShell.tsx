/** 语音浮层的壳：五种形态共用的一层底，尺寸与圆角在形态之间连续插值。 */

import type { HTMLMotionProps, TargetAndTransition, Transition } from 'motion/react'
import { motion } from 'motion/react'
import { memo } from 'react'
import { cn } from 'utils'
import { VOICE_IME_SHELL_SPRING, VOICE_IME_SHELL_SURFACE_CLASS } from '../constants'

/**
 * 胶囊与结果卡共用的壳
 *
 * 底色、投影、圆角都由壳画，里面的视图只画内容：形态一换，壳从旧尺寸 / 圆角插到新值，
 * 胶囊看上去是**长成**卡片的。壳只接管尺寸与圆角这几个值，其余 motion / DOM 属性原样
 * 透传：宿主自己决定它是 `fixed` 还是在流内、要不要淡入淡出、挂什么 aria
 *
 * 宿主给的 `initial` 会与壳的尺寸 / 圆角目标合并——不合并的话壳会从 DOM 读到的
 * 「宽 = 文案宽、0 圆角」一路长过去，出场先是一块变形的影子；缺省 `initial={false}`，
 * 挂载即到位。这一点也是收窗后能整棵重挂的前提（见 `useVoiceImeViewport.mountKey`）
 */
export const VoiceImeShell = memo<VoiceImeShellProps>((props) => {
  const {
    variant = 'capsule',
    width,
    height,
    radius,
    className,
    initial = false,
    animate,
    transition,
    ...rest
  } = props

  const target = { width, height, borderRadius: radius }

  return (
    <motion.div
      { ...rest }
      className={ cn(
        'overflow-hidden text-text transition-[background-color,box-shadow] duration-300',
        VOICE_IME_SHELL_SURFACE_CLASS[variant],
        className,
      ) }
      initial={ initial === false
        ? false
        : { ...target, ...initial } }
      animate={ { ...target, ...animate } }
      transition={ { ...VOICE_IME_SHELL_SPRING, ...transition } }
    />
  )
})

VoiceImeShell.displayName = 'VoiceImeShell'

/** 壳的两个外观端点：白胶囊，或 Bg/3 底的结果卡 */
export type VoiceImeShellVariant = 'capsule' | 'card'

export type VoiceImeShellProps = {
  /** @default 'capsule' */
  variant?: VoiceImeShellVariant
  /** 壳要长到的内容宽度（CSS px，不含窗口留白） */
  width: number
  /** 壳要长到的内容高度 */
  height: number
  /** 壳要变到的圆角，胶囊形态按 `getVoiceImeShellRadius` 给成半高 */
  radius: number
  /**
   * 进场起点，只写额外要动的值（如 `{ opacity: 0, y: 8 }`），尺寸与圆角由壳补齐
   * @default false
   */
  initial?: TargetAndTransition | false
  /** 与壳的尺寸 / 圆角目标合并，只写额外要动的值（如 `{ opacity: 1, y: 0 }`） */
  animate?: TargetAndTransition
  /**
   * 与壳的弹簧合并。只按值覆盖（`{ opacity: { duration: 0.2 } }`），
   * 顶层写 `duration` 会把尺寸那条弹簧改成定时弹簧
   */
  transition?: Transition
} & Omit<HTMLMotionProps<'div'>, 'initial' | 'animate' | 'transition'>
