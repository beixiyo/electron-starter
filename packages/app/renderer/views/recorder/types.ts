import type { ButtonVariant } from 'comps'
import type { ReactNode } from 'react'

/**
 * 控制操作按钮描述
 */
export type PrimaryAction = {
  /**
   * 显示文案
   */
  label: string
  /**
   * 点击回调
   */
  onClick: () => void | Promise<void>
  /**
   * 按钮样式
   */
  variant: ButtonVariant
  /**
   * 是否禁用
   */
  disabled: boolean
  /**
   * 按钮左侧图标
   */
  icon: ReactNode
  /**
   * 是否展示加载
   */
  loading: boolean
}
