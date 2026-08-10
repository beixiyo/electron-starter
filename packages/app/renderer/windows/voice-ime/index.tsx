import { useShortcutRuntime } from '@/shortcuts/useShortcutRuntime'
import { mountTransparentWindow } from '../shared'
import { VoiceImeApp } from './VoiceImeApp'
/** 本窗口渲染 comps 组件，须引 @/tailwind.css 以带上 comps/index.css 的工具类（见 floating-status-pool 说明） */
import '@/tailwind.css'

function ShortcutRuntimeVoiceImeApp() {
  useShortcutRuntime()
  return <VoiceImeApp />
}

mountTransparentWindow(<ShortcutRuntimeVoiceImeApp />)
