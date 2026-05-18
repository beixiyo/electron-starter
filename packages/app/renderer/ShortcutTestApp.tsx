import type { ShortcutTestPayload } from '@shared'
import { WindowType } from '@shared'
import { useTheme } from 'hooks'
import { memo, useEffect, useState } from 'react'
import { cn } from 'utils'

export const ShortcutTestApp = memo(() => {
  useTheme()
  const [trigger, setTrigger] = useState<ShortcutTestPayload | null>(null)

  useEffect(() => {
    return $ipc.shortcutTest.onTrigger((payload) => {
      setTrigger(payload)
    })
  }, [])

  const handleClose = () => {
    $ipc.window.hide(WindowType.SHORTCUT_TEST)
  }

  const triggerColor = trigger
    ? {
        hold: 'text-emerald-400',
        doublePress: 'text-sky-400',
        combo: 'text-amber-400',
      }[trigger.triggerType]
    : ''

  return (
    <div
      className={ cn(
        'relative flex items-center justify-center w-screen h-screen',
        'bg-background text-text backdrop-blur-2xl rounded-2xl',
        'border border-border shadow-2xl',
      ) }
    >
      <button
        type="button"
        onClick={ handleClose }
        className={ cn(
          'absolute top-3 right-3 w-7 h-7 rounded-full',
          'flex items-center justify-center text-sm',
          'text-text3 hover:text-text hover:bg-background3',
          'transition-colors cursor-pointer',
        ) }
      >
        ✕
      </button>

      { trigger
        ? (
            <div className="flex flex-col items-center gap-3">
              <div className={ cn('text-2xl font-semibold tracking-wide', triggerColor) }>
                { trigger.label }
              </div>

              <div className="text-xs text-text3 uppercase tracking-widest">
                { trigger.triggerType }
              </div>
            </div>
          )
        : (
            <div className="text-sm text-text3">
              Waiting for shortcut...
            </div>
          ) }
    </div>
  )
})

ShortcutTestApp.displayName = 'ShortcutTestApp'
