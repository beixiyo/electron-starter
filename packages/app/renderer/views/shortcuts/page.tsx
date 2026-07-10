import { ShortcutRow } from './ShortcutRow'
import { useRecordBinding } from './useRecordBinding'
import { useShortcutRecordingSession } from './useShortcutRecordingSession'
import { useShortcutsList } from './useShortcutsList'

export default function ShortcutsPage() {
  const { actions, replaceBinding, updateBindingScope, resetToDefault } = useShortcutsList()
  const recorder = useRecordBinding()
  const session = useShortcutRecordingSession(actions, recorder, replaceBinding)

  return (
    <div className="px-6 py-7 md:px-8 md:py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold leading-7 text-text">快捷键</h1>
        <p className="mt-1 text-sm leading-5 text-text3">管理全局和窗口内快捷键，点击按键区域开始录制</p>
      </header>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-background shadow-[0_8px_24px_rgba(0,0,0,0.05)]">
        { actions.map((action, index) => (
          <div key={ action.id }>
            <ShortcutRow
              action={ action }
              isRecording={ session.recordingId === action.id && recorder.isRecording }
              isDetected={ session.recordingId === action.id && recorder.isDetected }
              isUnsupported={ session.recordingId === action.id && recorder.isUnsupported }
              scope={ session.recordingId === action.id
                ? session.recordingScope
                : session.resolveScope(action.binding?.scope ?? (session.canUseGlobalScope ? 'global' : 'local')) }
              canUseGlobalScope={ session.canUseGlobalScope }
              detected={ session.recordingId === action.id
                ? recorder.detected
                : null }
              onStartRecord={ () => session.start(action.id) }
              onScopeChange={ (scope) => {
                const nextScope = session.resolveScope(scope)
                if (session.recordingId === action.id) {
                  session.changeScope(nextScope)
                  return
                }
                updateBindingScope(action.id, nextScope)
              } }
              onConfirm={ session.confirm }
              onCancel={ session.cancel }
              onReset={ () => resetToDefault(action.id) }
            />
            { index < actions.length - 1 && <div className="mx-5 h-px bg-border" /> }
          </div>
        )) }
      </div>
    </div>
  )
}
