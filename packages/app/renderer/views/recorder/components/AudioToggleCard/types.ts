/**
 * 音频设置开关组件 Props
 */
export type AudioToggleCardProps = {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void | Promise<void>
}
