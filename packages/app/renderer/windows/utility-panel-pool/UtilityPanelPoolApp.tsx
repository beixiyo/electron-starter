import type { FocusPayload } from '@ipc/services/focus/contract'
import type { SelectionData } from '@shared'
import type { ShortcutTestPayload } from '../shortcut-test/ShortcutTestApp'
import { WindowType } from '@shared'
import { memo } from 'react'
import { FocusNativeApp } from '../focus-native/FocusNativeApp'
import { SelectionApp } from '../selection/SelectionApp'
import { useLogicalWindowRoute } from '../shared'
import { ShortcutTestApp } from '../shortcut-test/ShortcutTestApp'

export const UtilityPanelPoolApp = memo(() => {
  const route = useLogicalWindowRoute(WindowType.UTILITY_PANEL_POOL)

  if (!route)
    return null

  if (route.role === 'selection') {
    return (
      <SelectionApp
        key={ route.token }
        initialData={ route.payload as SelectionData | null }
      />
    )
  }

  if (route.role === 'shortcut-test') {
    return (
      <ShortcutTestApp
        key={ route.token }
        initialTrigger={ route.payload as ShortcutTestPayload | null }
      />
    )
  }

  if (route.role === 'focus-native') {
    return (
      <FocusNativeApp
        key={ route.token }
        initialFocus={ route.payload as FocusPayload | null }
      />
    )
  }

  return null
})

UtilityPanelPoolApp.displayName = 'UtilityPanelPoolApp'
