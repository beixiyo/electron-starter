import { transcribeDemoAudio } from '@/demo/voiceTranscription'
import { useShortcutRuntime } from '@/shortcuts/useShortcutRuntime'
import { mountTransparentWindow } from '../shared'
import { VoiceImeApp } from './VoiceImeApp'
/** 本窗口渲染通用语音输入组件，须引 @/tailwind.css 以带上共享样式。 */
import '@/tailwind.css'
import '@/locales'

function ShortcutRuntimeVoiceImeApp() {
  useShortcutRuntime()
  return <VoiceImeApp transcribe={ transcribeDemoAudio } />
}

mountTransparentWindow(<ShortcutRuntimeVoiceImeApp />)
