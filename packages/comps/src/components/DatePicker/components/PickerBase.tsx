'use client'

import type { FloatingPlacement } from 'hooks'
import { useKeyboardLayer, useTheme } from 'hooks'
import { memo, useRef } from 'react'
import { cn } from 'utils'
import { Z } from '../../../constants/z-index'
import { useNestedLayerPriority } from '../../../hooks/useKeyboardLayerHost'
import { AnimateShow } from '../../Animate'
import { SafePortal } from '../../SafePortal'
import { CONTAINER_CLASSNAME } from '../constants'
import { useClickOutside } from '../hooks/useClickOutside'
import { usePickerFloating } from '../hooks/usePickerFloating'

interface PickerBaseProps {
  isOpen: boolean
  setOpen: (open: boolean) => void
  trigger: React.ReactNode
  dropdown: React.ReactNode
  placement?: FloatingPlacement
  offset?: number
  onClickOutside?: () => void
  onDismiss?: (reason: PickerDismissReason) => void
  onConfirm?: () => void
  onBlur?: () => void
  className?: string
  dropdownClassName?: string
  dropdownZIndex?: number
  error?: boolean
  errorMessage?: React.ReactNode
  fullWidth?: boolean
}

export const PickerBase = memo<PickerBaseProps>(({
  isOpen,
  setOpen,
  trigger,
  dropdown,
  placement = 'bottom-start',
  offset = 4,
  onClickOutside,
  onDismiss,
  onConfirm,
  onBlur,
  className,
  dropdownClassName,
  dropdownZIndex,
  error,
  errorMessage,
  fullWidth = true,
}) => {
  const [theme] = useTheme()
  const triggerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const { style, shouldAnimate } = usePickerFloating({
    enabled: isOpen,
    triggerRef,
    dropdownRef,
    placement,
    offset,
  })

  useClickOutside({
    enabled: isOpen,
    triggerRef,
    dropdownRef,
    onClickOutside,
    onClose: () => {
      if (onDismiss)
        onDismiss('outside')
      else
        setOpen(false)
      onBlur?.()
    },
  })

  /** 嵌在弹窗 / 气泡里时至少压过宿主，否则 Esc 关掉的是宿主而不是这个面板 */
  const layerPriority = useNestedLayerPriority(dropdownZIndex ?? Z.dropdown)

  useKeyboardLayer({
    active: isOpen,
    keys: onConfirm
      ? ['Escape', 'Enter']
      : ['Escape'],
    priority: layerPriority,
    allowRepeat: false,
    onKeyDown: (event) => {
      if (event.key === 'Enter') {
        onConfirm?.()
        return
      }

      if (onDismiss)
        onDismiss('escape')
      else
        setOpen(false)
      onBlur?.()
    },
  })

  const dropdownContent = (
    <AnimateShow
      show={ isOpen && shouldAnimate }
      ref={ dropdownRef }
      variants="fade"
      animateOnMount={ false }
      style={ {
        ...style,
        zIndex: dropdownZIndex ?? Z.dropdown,
      } }
      className={ cn(
        CONTAINER_CLASSNAME,
        theme !== 'light' && 'border border-border',
        dropdownClassName,
      ) }
    >
      { dropdown }
    </AnimateShow>
  )

  return (
    <div className={ cn('inline-block', fullWidth && 'w-full', className) }>
      <div ref={ triggerRef } className={ cn(fullWidth && 'w-full') }>
        { trigger }
      </div>

      <SafePortal>{ dropdownContent }</SafePortal>

      { error && errorMessage && (
        <div className="mt-1 text-xs text-danger">
          { errorMessage }
        </div>
      ) }
    </div>
  )
})

PickerBase.displayName = 'PickerBase'

export type PickerDismissReason = 'outside' | 'escape'
