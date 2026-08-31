import type { ReactNode } from 'react'
import { memo } from 'react'

/** 音频实验面板中的单项设置；左侧解释语义，右侧只放一个明确控件。 */
export const SettingRow = memo<SettingRowProps>((props) => {
  const { control, description, title } = props

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-background3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{ title }</p>
        <p className="mt-0.5 text-xs leading-5 text-text3">{ description }</p>
      </div>
      <div className="w-36 shrink-0">{ control }</div>
    </div>
  )
})

SettingRow.displayName = 'SettingRow'

export type SettingRowProps = {
  title: string
  description: string
  control: ReactNode
}
