import { memo } from 'react'
import { ShortcutRecorder } from './ShortcutRecorder'
import { ShortcutSettingsProvider, useShortcutSettingsActions } from './ShortcutSettingsProvider'

/** 快捷键管理页，保持为独立路由。 */
export default function ShortcutsPage() {
  return (
    <ShortcutSettingsProvider>
      <ShortcutsContent />
    </ShortcutSettingsProvider>
  )
}

const ShortcutsContent = memo(() => {
  const actions = useShortcutSettingsActions()

  return (
    <div className="h-full overflow-y-auto px-8 py-8 lg:px-13 lg:py-10">
      <header className="mb-6">
        <h1 className="text-[22px] font-medium leading-8 text-text">快捷键</h1>
        <p className="mt-1 text-sm leading-5 text-text3">管理快捷键，点击按键区域开始录制</p>
      </header>

      <div className="max-w-180 overflow-hidden rounded-2xl bg-background2 shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
        { actions.map((action, index) => (
          <div key={ action.id }>
            <div className="flex min-h-14 items-center gap-4 px-5 py-3">
              <span className="flex-1 text-sm text-text">{ action.label }</span>
              <ShortcutRecorder actionId={ action.id } />
            </div>
            { index < actions.length - 1 && <div className="mx-5 h-px bg-border/60" /> }
          </div>
        )) }
      </div>
    </div>
  )
})

ShortcutsContent.displayName = 'ShortcutsContent'
