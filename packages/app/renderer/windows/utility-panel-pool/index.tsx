import { useShortcutRuntime } from '@/shortcuts/useShortcutRuntime'
import { mountTransparentWindow } from '../shared'
import { UtilityPanelPoolApp } from './UtilityPanelPoolApp'
/** 挂载的 shortcut-test / selection 等 App 渲染 comps 组件，须引 @/tailwind.css（见 floating-status-pool 说明） */
import '@/tailwind.css'

function ShortcutRuntimeUtilityPanelPoolApp() {
  useShortcutRuntime()
  return <UtilityPanelPoolApp />
}

mountTransparentWindow(<ShortcutRuntimeUtilityPanelPoolApp />)
